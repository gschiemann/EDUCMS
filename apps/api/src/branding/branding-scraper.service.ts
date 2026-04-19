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
import { parseColor, derivePalette, contrastRatio, wcagGrade, DerivedPalette } from './color-utils';
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
    const htmlRes = await safeFetch(url, {
      timeoutMs: Math.min(remaining(), 10_000),
      maxBytes: 5 * 1024 * 1024,
      accept: 'text/html,application/xhtml+xml',
    });
    const html = htmlRes.body.toString('utf-8');
    const $ = cheerio.load(html);
    const finalUrl = htmlRes.finalUrl;
    const pageOrigin = new URL(finalUrl).origin;
    const absolutize = (href: string | undefined): string | null => {
      if (!href) return null;
      try { return new URL(href, finalUrl).toString(); } catch { return null; }
    };

    // 2. Metadata: display name, tagline, og/twitter images.
    const ogSiteName = $('meta[property="og:site_name"]').attr('content')?.trim();
    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
    const twitterTitle = $('meta[name="twitter:title"]').attr('content')?.trim();
    const pageTitle = $('title').first().text().trim();
    const cleanedTitle = (pageTitle || '')
      .replace(/\s*[|\-–—]\s*(Home|Welcome|Official Site|Home Page).*$/i, '')
      .replace(/\s*[|\-–—]\s*$/g, '')
      .trim();
    const hostDerivedName = (() => {
      try {
        const h = new URL(finalUrl).hostname.replace(/^www\./, '');
        const root = h.split('.').slice(0, -1).join(' ');
        return root.split(/[-_]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      } catch { return null; }
    })();
    const displayName = ogSiteName || ogTitle || twitterTitle || cleanedTitle || hostDerivedName || null;

    const metaDesc = $('meta[name="description"]').attr('content')?.trim();
    const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
    const firstH2 = $('h2').first().text().trim();
    const tagline = ogDesc || metaDesc || firstH2 || null;

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

      // Reject tiny icons by viewBox (e.g. 24x24 social glyphs).
      const viewBox = ($el.attr('viewBox') || '').split(/[ ,]+/).map(Number);
      if (viewBox.length === 4) {
        const vbW = viewBox[2], vbH = viewBox[3];
        const aspect = vbW && vbH ? vbW / vbH : 1;
        // Pure square ≤ 32px is almost always an icon, not a wordmark.
        if (vbW <= 32 && vbH <= 32 && aspect > 0.7 && aspect < 1.4) return;
      }

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
      const src = absolutize($el.attr('src') || $el.attr('data-src') || '');
      if (!src) return;
      const alt = ($el.attr('alt') || '').toLowerCase();
      const cls = ($el.attr('class') || '').toLowerCase();
      const id = ($el.attr('id') || '').toLowerCase();
      const combined = `${alt} ${cls} ${id} ${src.toLowerCase()}`;
      const logoRe = /(logo|wordmark|brand|mark|crest|shield|seal)/;
      if (!logoRe.test(combined)) return;
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
      const src = absolutize($el.attr('src') || $el.attr('data-src') || '');
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
      displayName: ogSiteName ? 0.95 : ogTitle ? 0.85 : cleanedTitle ? 0.7 : 0.4,
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

    // 11. WCAG sanity — if primary fails AA against the ink/surface
    // pair, warn the caller.
    const primaryTextRatio = contrastRatio(palette.primary, palette.primaryInk);
    if (wcagGrade(primaryTextRatio) === 'fail') {
      warnings.push(`Primary color has insufficient contrast (${primaryTextRatio.toFixed(1)}:1) — consider a darker/lighter shade.`);
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
    const key = first.toLowerCase();
    const prev = map.get(key) ?? { family: first, googleFont: matchGoogleFont(first), score: 0, occurrences: 0, weightsSeen: [], role };
    prev.occurrences += 1;
    prev.score += weight;
    // Role precedence: heading > body > either
    if (role === 'heading') prev.role = 'heading';
    else if (role === 'body' && prev.role === 'either') prev.role = 'body';
    map.set(key, prev);
  }
}
