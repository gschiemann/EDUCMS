/**
 * Turn what the page observed (viewport px, CSS px, raw pixels) into the typed
 * `RenderMetrics` of the contract (canvas px, judgements, summaries). Pure —
 * no browser, no I/O — so every threshold here is exercised by unit tests.
 */
import type {
  BlockedRequest,
  ClippedItem,
  ContrastSample,
  FitRepairs,
  FontFallback,
  FontFamilyUsage,
  ImageItem,
  OverflowItem,
  OverlapItem,
  RenderMetrics,
  TextRef,
} from '../contract.js';
import type { RawPageLog, RawPageMeasure, RawText, VRect } from '../page/types.js';
import { roundRatio, toHex } from './color.js';
import { looksOccluded, measureTextContrast } from './contrast.js';
import { findOverlaps, scaleBox, type Box } from './geometry.js';
import { gridEmptiness } from './grid.js';
import { BLURRY_UPSCALE, aspectDistortion, backgroundDrawnSize, objectFitDrawnSize, upscaleRatio } from './images.js';
import type { PixelImage, PxRect } from './pixels.js';

/** Legibility floor: 2.4 % of the canvas short side (designer-prompt.ts / the fit engine's MINPX). */
export const FLOOR_PCT = 0.024;
/** Overlap threshold, canvas px, both axes. */
export const OVERLAP_MIN_PX = 6;
export const EMPTY_TARGET = 0.35;

export interface PlatformFont {
  family: string;
  custom: boolean;
  glyphs: number;
}

export interface FontRequestLog {
  /** Family → the stylesheet URL that asked for it. */
  notBundled: Map<string, string>;
  /** css2 selectors answered 400. */
  rejected: Array<{ family: string; reason: string }>;
  served: Set<string>;
}

export interface AssembleInput {
  raw: RawPageMeasure;
  log: RawPageLog;
  canvasWidth: number;
  canvasHeight: number;
  viewportScale: number;
  /** The decoded screenshot; its pixels are viewport px × dpr. */
  image: PixelImage;
  /** The same frame with every glyph fill transparent; null when it could not be taken. */
  plate: PixelImage | null;
  dpr: number;
  blocked: BlockedRequest[];
  fontRequests: FontRequestLog;
  /** textId → fonts Chromium used for that element; null when the probe did not run. */
  platformFonts: Map<number, PlatformFont[]> | null;
  /** lower-case system family → bundled look-alike family. */
  substitutes: Map<string, string>;
  pageErrors: string[];
  warnings: string[];
}

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
  '-apple-system',
  'blinkmacsystemfont',
]);

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** How far past an edge ink may go before it counts, per side (canvas px). */
export interface EdgeTolerance {
  top: number;
  bottom: number;
  side: number;
}

/**
 * Horizontal spill always cuts letters, so a few px counts. Vertically, a
 * tight line-height legitimately lets DESCENDERS hang below a box (and accents
 * poke above it): a cut or spill that stays inside the descender band is
 * tolerated, one that reaches the letter bodies above the baseline is not.
 */
export function edgeTolerance(fontPx: number, descentPx: number): EdgeTolerance {
  const descent = descentPx > 0 ? descentPx : 0.25 * fontPx;
  return { top: Math.max(4, 0.15 * fontPx), bottom: Math.max(4, descent + 2), side: Math.max(4, 0.02 * fontPx) };
}

function sidesOver(e: { top: number; right: number; bottom: number; left: number }, tol: EdgeTolerance) {
  const sides: Array<'top' | 'right' | 'bottom' | 'left'> = [];
  let worst = 0;
  if (e.top > tol.top) {
    sides.push('top');
    worst = Math.max(worst, e.top);
  }
  if (e.bottom > tol.bottom) {
    sides.push('bottom');
    worst = Math.max(worst, e.bottom);
  }
  if (e.left > tol.side) {
    sides.push('left');
    worst = Math.max(worst, e.left);
  }
  if (e.right > tol.side) {
    sides.push('right');
    worst = Math.max(worst, e.right);
  }
  return { sides, worst };
}

function scaleSides(e: { top: number; right: number; bottom: number; left: number }, kx: number, ky: number) {
  return { top: e.top * ky, bottom: e.bottom * ky, left: e.left * kx, right: e.right * kx };
}

/** Cluster font sizes within 5 %, largest first, weighted by characters. */
export function sizeTiers(entries: Array<{ px: number; chars: number }>): Array<{ px: number; elements: number; characters: number }> {
  const sorted = [...entries].filter((e) => e.px > 0).sort((a, b) => b.px - a.px);
  const tiers: Array<{ px: number; elements: number; characters: number }> = [];
  for (const e of sorted) {
    const last = tiers[tiers.length - 1];
    if (last && e.px >= last.px * 0.95) {
      last.elements += 1;
      last.characters += e.chars;
    } else {
      tiers.push({ px: round1(e.px), elements: 1, characters: e.chars });
    }
  }
  return tiers;
}

export function assembleMetrics(input: AssembleInput): RenderMetrics {
  const { raw, canvasWidth, canvasHeight, image, dpr } = input;
  const vw = raw.viewport.width || 1;
  const vh = raw.viewport.height || 1;
  const kx = canvasWidth / vw;
  const ky = canvasHeight / vh;
  const shortSide = Math.min(canvasWidth, canvasHeight);
  const floorPx = shortSide * FLOOR_PCT;
  const warnings = [...input.warnings, ...raw.warnings];
  if (raw.textLimitHit) warnings.push(`only the first ${raw.texts.length} text elements were measured`);

  const fontPx = (t: RawText) => t.fontSizeCss * t.scale * kx;
  const isDecorative = (t: RawText) => t.ariaHidden || t.opacity < 0.2;
  const isVisible = (t: RawText) => t.visibleArea > 1;
  const ref = (t: RawText): TextRef => ({
    field: t.field,
    selector: t.selector,
    text: t.text,
    fontPx: round1(fontPx(t)),
    decorative: isDecorative(t),
  });
  const toCanvas = (r: VRect): Box => scaleBox(r, kx, ky);
  const toPixels = (r: VRect): PxRect => ({ x: r.x * dpr, y: r.y * dpr, w: r.w * dpr, h: r.h * dpr });

  // ── text ────────────────────────────────────────────────────────────────
  const visible = raw.texts.filter(isVisible);
  const readable = visible.filter((t) => !isDecorative(t));
  const bySize = [...readable].sort((a, b) => fontPx(a) - fontPx(b));
  const smallest = bySize[0];
  const belowFloorAll = bySize.filter((t) => fontPx(t) < floorPx - 0.5);
  const tiers = sizeTiers(readable.map((t) => ({ px: fontPx(t), chars: t.chars })));
  const text: RenderMetrics['text'] = {
    elements: readable.length,
    decorativeElements: visible.length - readable.length,
    characters: readable.reduce((s, t) => s + t.chars, 0),
    floorPx: round1(floorPx),
    minFont: smallest ? { ...ref(smallest), pctShortSide: round3((fontPx(smallest) / shortSide) * 100) } : null,
    belowFloorCount: belowFloorAll.length,
    belowFloor: belowFloorAll.slice(0, 20).map(ref),
    sizeTiers: tiers,
    largestPx: tiers[0]?.px ?? null,
    topTwoRatio: tiers.length >= 2 ? roundRatio((tiers[0]?.px ?? 0) / (tiers[1]?.px ?? 1)) : null,
  };

  // ── overflow + clipping ─────────────────────────────────────────────────
  const overflowItems: OverflowItem[] = [];
  const clippedItems: ClippedItem[] = [];
  for (const t of raw.texts) {
    const tol = edgeTolerance(fontPx(t), t.descentVp * ky);
    const stage = sidesOver(scaleSides(t.stage, kx, ky), tol);
    if (stage.sides.length > 0) {
      overflowItems.push({ ...ref(t), kind: 'stage', overflowPx: round1(stage.worst), sides: stage.sides, boxSelector: null });
    }
    if (t.boxOverflow) {
      const box = sidesOver(scaleSides(t.boxOverflow, kx, ky), tol);
      if (box.sides.length > 0) {
        overflowItems.push({ ...ref(t), kind: 'box', overflowPx: round1(box.worst), sides: box.sides, boxSelector: t.boxOverflow.selector });
      }
    }
    if (t.clip && t.clip.nearEdge) {
      const c = sidesOver(scaleSides(t.clip, kx, ky), tol);
      const hidden = t.inkArea > 0 ? Math.min(1, Math.max(0, 1 - t.visibleArea / t.inkArea)) : 0;
      if (c.sides.length === 0 && hidden < 0.25) continue;
      if (t.clip.coversViewport) {
        // Cut off by a stage-sized box: that is "off the canvas".
        if (stage.sides.length === 0) {
          overflowItems.push({ ...ref(t), kind: 'stage', overflowPx: round1(c.worst), sides: c.sides, boxSelector: null });
        }
        continue;
      }
      clippedItems.push({
        ...ref(t),
        kind: t.clip.kind,
        clippedPx: round1(c.worst || Math.max(t.clip.top * ky, t.clip.bottom * ky, t.clip.left * kx, t.clip.right * kx)),
        hiddenFraction: round3(hidden),
        clipSelector: t.clip.selector,
      });
    }
  }
  overflowItems.sort((a, b) => b.overflowPx - a.overflowPx);
  clippedItems.sort((a, b) => b.hiddenFraction - a.hiddenFraction || b.clippedPx - a.clippedPx);

  // ── overlaps (readable text only) ───────────────────────────────────────
  const pairs = findOverlaps(
    readable.map((t) => ({ id: t.id, boxes: t.visibleRects.map(toCanvas) })),
    OVERLAP_MIN_PX,
  );
  const byId = new Map(raw.texts.map((t) => [t.id, t]));
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const overlapItems: OverlapItem[] = pairs
    .sort((p, q) => q.w * q.h - p.w * p.h)
    .slice(0, 40)
    .map((p) => {
      const a = byId.get(p.a) as RawText;
      const b = byId.get(p.b) as RawText;
      return {
        a: ref(a),
        b: ref(b),
        overlapW: round1(p.w),
        overlapH: round1(p.h),
        identicalText: norm(a.text) === norm(b.text),
      };
    });

  // ── fit-engine repairs ──────────────────────────────────────────────────
  const shrunkText = raw.fit.vosFs
    .map((v) => ({
      field: v.field,
      selector: v.selector,
      text: v.text,
      originalPx: round1(v.originalCss * v.scale * kx),
      currentPx: round1(v.currentCss * v.scale * kx),
      scale: round3(v.currentCss / v.originalCss),
    }))
    .filter((v) => Math.abs(v.scale - 1) > 0.02);
  const shrunkOnly = shrunkText.filter((v) => v.scale < 1);
  const decorations = raw.fit.vgw
    .map((d) => {
      const sw = d.originalW > 0 ? d.currentW / d.originalW : 1;
      const sh = d.originalH > 0 ? d.currentH / d.originalH : 1;
      return {
        selector: d.selector,
        originalW: round1(d.originalW * d.scale * kx),
        originalH: round1(d.originalH * d.scale * ky),
        currentW: round1(d.currentW * d.scale * kx),
        currentH: round1(d.currentH * d.scale * ky),
        scale: round3(Math.min(sw, sh)),
        dimmed: d.dimmed,
      };
    })
    .filter((d) => d.scale < 0.98 || d.dimmed);
  const columns = raw.fit.fitCol.map((c) => ({ ...c, scale: round3(c.scale) })).filter((c) => c.scale < 0.98);
  const dataFit = raw.fit.dataFit
    .map((d) => ({
      field: d.field,
      selector: d.selector,
      text: d.text,
      authoredPx: round1(d.authoredCss * d.scale * kx),
      renderedPx: round1(d.renderedCss * d.scale * kx),
      scale: round3(d.renderedCss / d.authoredCss),
    }))
    .filter((d) => d.scale < 0.98);
  const minOf = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
  const fitRepairs: FitRepairs = {
    textScaled: { count: shrunkOnly.length, minScale: minOf(shrunkOnly.map((v) => v.scale)), items: shrunkText.slice(0, 30) },
    raisedToFloor: shrunkText.filter((v) => v.scale > 1).length,
    decorations: {
      count: decorations.length,
      dimmed: decorations.filter((d) => d.dimmed).length,
      minScale: minOf(decorations.map((d) => d.scale)),
      items: decorations.slice(0, 20),
    },
    columns: { count: columns.length, minScale: minOf(columns.map((c) => c.scale)), items: columns.slice(0, 20) },
    dataFit: { count: dataFit.length, minScale: minOf(dataFit.map((d) => d.scale)), items: dataFit.slice(0, 30) },
    overcrowded: [shrunkOnly, columns, dataFit].some((list) => list.some((x) => x.scale < 0.9)),
  };

  // ── images ──────────────────────────────────────────────────────────────
  const imageItems: ImageItem[] = raw.images.map((im) => {
    const natural = { w: im.naturalW, h: im.naturalH };
    const box = { w: im.boxW, h: im.boxH };
    const drawnCss = im.kind === 'img' ? objectFitDrawnSize(box, natural, im.fit) : backgroundDrawnSize(im.fit, box, natural);
    const drawn = { w: drawnCss.w * im.scale * kx, h: drawnCss.h * im.scale * ky };
    const upscale = im.broken || im.vector ? null : upscaleRatio(drawn, natural);
    return {
      kind: im.kind,
      selector: im.selector,
      slot: im.slot,
      src: im.src,
      naturalWidth: im.naturalW,
      naturalHeight: im.naturalH,
      drawnWidth: round1(drawn.w),
      drawnHeight: round1(drawn.h),
      upscale: upscale === null ? null : roundRatio(upscale),
      blurry: upscale !== null && upscale > BLURRY_UPSCALE && im.visible,
      broken: im.broken,
      vector: im.vector,
      distortion:
        im.kind === 'img' && (im.fit === 'fill' || !im.fit) && !im.broken
          ? (() => {
              const d = aspectDistortion(drawnCss, natural);
              return d === null ? null : roundRatio(d);
            })()
          : null,
      visible: im.visible,
    };
  });
  imageItems.sort((a, b) => Number(b.broken) - Number(a.broken) || (b.upscale ?? 0) - (a.upscale ?? 0));
  const upscales = imageItems.filter((i) => i.visible && i.upscale !== null).map((i) => i.upscale as number);

  // ── fonts ───────────────────────────────────────────────────────────────
  const substitutes = input.substitutes;
  const pageFaceFamilies = new Set(
    raw.fontFaces.filter((f) => !substitutes.has(f.family.toLowerCase())).map((f) => f.family.toLowerCase()),
  );
  const loadedFaceFamilies = new Set(
    raw.fontFaces.filter((f) => f.status === 'loaded').map((f) => f.family.toLowerCase()),
  );
  const erroredFaceFamilies = new Set(
    raw.fontFaces.filter((f) => f.status === 'error').map((f) => f.family.toLowerCase()),
  );
  interface FamilyAgg {
    family: string;
    elements: number;
    characters: number;
    glyphs: Map<string, { custom: boolean; glyphs: number }>;
    probed: boolean;
  }
  const families = new Map<string, FamilyAgg>();
  for (const t of visible) {
    const key = t.primaryFamily.toLowerCase();
    if (!key) continue;
    let agg = families.get(key);
    if (!agg) {
      agg = { family: t.primaryFamily, elements: 0, characters: 0, glyphs: new Map(), probed: false };
      families.set(key, agg);
    }
    agg.elements += 1;
    agg.characters += t.chars;
    const fonts = input.platformFonts?.get(t.id);
    // Only text with letters or digits is evidence about the family.
    if (fonts && t.hasWordChars) {
      agg.probed = true;
      for (const pf of fonts) {
        const e = agg.glyphs.get(pf.family) ?? { custom: pf.custom, glyphs: 0 };
        e.glyphs += pf.glyphs;
        agg.glyphs.set(pf.family, e);
      }
    }
  }
  const squash = (s: string) => s.toLowerCase().replace(/[\s'"_-]+/g, '');
  const fonts: FontFamilyUsage[] = [];
  const fallbacks: FontFallback[] = [];
  const fallbackKeys = new Set<string>();
  const addFallback = (f: FontFallback) => {
    const key = `${f.family.toLowerCase()}|${f.reason}`;
    if (fallbackKeys.has(key)) return;
    fallbackKeys.add(key);
    fallbacks.push(f);
  };
  for (const [key, agg] of families) {
    const renderedWith = [...agg.glyphs.entries()].sort((a, b) => b[1].glyphs - a[1].glyphs).map(([name]) => name);
    let total = 0;
    let custom = 0;
    for (const g of agg.glyphs.values()) {
      total += g.glyphs;
      if (g.custom) custom += g.glyphs;
    }
    const customShare = total > 0 ? custom / total : 0;
    const substitute = substitutes.get(key) ?? null;
    let status: FontFamilyUsage['status'];
    if (GENERIC_FAMILIES.has(key)) status = 'generic';
    else if (!agg.probed) {
      if (substitute) status = loadedFaceFamilies.has(key) ? 'substituted' : 'unverified';
      else if (pageFaceFamilies.has(key)) status = loadedFaceFamilies.has(key) ? 'webfont' : 'fallback';
      else status = 'unverified';
    } else if (substitute) status = customShare >= 0.5 ? 'substituted' : 'fallback';
    else if (pageFaceFamilies.has(key)) status = customShare >= 0.5 ? 'webfont' : 'fallback';
    else status = renderedWith[0] && squash(renderedWith[0]).startsWith(squash(agg.family)) ? 'system' : 'fallback';
    fonts.push({
      family: agg.family,
      status,
      servedAs: status === 'substituted' ? substitute : null,
      renderedWith: renderedWith.slice(0, 4),
      elements: agg.elements,
      characters: agg.characters,
    });
    if (status === 'fallback') {
      const notBundledUrl = input.fontRequests.notBundled.get(key);
      addFallback({
        family: agg.family,
        reason: notBundledUrl
          ? 'not-bundled'
          : erroredFaceFamilies.has(key)
            ? 'load-failed'
            : pageFaceFamilies.has(key)
              ? 'load-failed'
              : 'not-installed',
        usedInText: true,
        renderedWith: renderedWith.slice(0, 4),
        detail: notBundledUrl ? 'requested from Google Fonts; not in the renderer bundle' : null,
      });
    }
  }
  fonts.sort((a, b) => b.characters - a.characters);
  for (const [key, url] of input.fontRequests.notBundled) {
    addFallback({
      family: families.get(key)?.family ?? key,
      reason: 'not-bundled',
      usedInText: families.has(key),
      renderedWith: [],
      detail: `requested by ${url.slice(0, 120)}`,
    });
  }
  for (const r of input.fontRequests.rejected) {
    addFallback({
      family: r.family,
      reason: 'google-fonts-error',
      usedInText: families.has(r.family.toLowerCase()),
      renderedWith: [],
      detail: `Google Fonts would answer this <link> with HTTP 400 (${r.reason}) — every family in it falls back on a screen`,
    });
  }
  for (const key of erroredFaceFamilies) {
    if (substitutes.has(key)) continue;
    addFallback({ family: key, reason: 'load-failed', usedInText: families.has(key), renderedWith: [], detail: 'a @font-face for it failed to load' });
  }
  for (const b of input.blocked) {
    if (b.reason === 'font') {
      addFallback({ family: b.url, reason: 'blocked', usedInText: false, renderedWith: [], detail: 'font URL outside the bundle' });
    }
  }

  // ── contrast (two frames: as shown, and the backplate) ─────────────────
  const samples: ContrastSample[] = [];
  if (input.plate) {
    for (const t of readable) {
      const reading = measureTextContrast(
        image,
        input.plate,
        t.visibleRects.map(toPixels),
        t.fill ? { r: t.fill.r, g: t.fill.g, b: t.fill.b, a: t.fill.a } : null,
        { maxSamples: 4000 },
      );
      if (!reading) continue;
      samples.push({
        ...ref(t),
        ratio: roundRatio(reading.ratio),
        minRatio: roundRatio(reading.minRatio),
        fg: toHex(reading.fg),
        bg: toHex(reading.bg),
        samples: reading.samples,
        inkShare: round3(reading.inkShare),
        occluded: looksOccluded(reading),
        effects: t.effects || reading.fgFromPixels,
      });
    }
  } else {
    warnings.push('contrast not measured: the backplate frame could not be captured');
  }
  samples.sort((a, b) => a.ratio - b.ratio);

  // ── empty space ─────────────────────────────────────────────────────────
  const viewportArea = vw * vh;
  const occupied: PxRect[] = [];
  for (const t of visible) for (const r of t.visibleRects) occupied.push(toPixels(r));
  for (const im of raw.images) {
    if (!im.visible || !im.rect) continue;
    // A full-bleed background photo is judged by its pixels, not its box —
    // otherwise one hero image would mark every cell "used".
    if (im.rect.w * im.rect.h > viewportArea * 0.6) continue;
    occupied.push(toPixels(im.rect));
  }
  const portrait = canvasHeight > canvasWidth;
  const grid = gridEmptiness(image, { cols: portrait ? 9 : 16, rows: portrait ? 16 : 9, occupied });

  // ── blocked requests ────────────────────────────────────────────────────
  const blockedAll: BlockedRequest[] = [...input.blocked];
  for (const v of input.log.csp) {
    if (v.uri && v.uri !== 'inline' && v.uri !== 'eval') {
      blockedAll.push({ url: v.uri.slice(0, 200), type: v.directive || 'csp', reason: 'csp' });
    }
  }
  for (const p of input.log.popups) blockedAll.push({ url: p.slice(0, 200), type: 'popup', reason: 'popup' });
  const seen = new Set<string>();
  const blockedUnique = blockedAll.filter((b) => {
    const key = `${b.reason}|${b.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
      shortSide,
      viewportWidth: vw,
      viewportHeight: vh,
      viewportScale: input.viewportScale,
      devicePixelRatio: dpr,
    },
    text,
    overflow: {
      count: overflowItems.filter((i) => !i.decorative).length,
      decorativeCount: overflowItems.filter((i) => i.decorative).length,
      items: overflowItems.slice(0, 30),
    },
    clipped: {
      count: clippedItems.filter((i) => !i.decorative).length,
      decorativeCount: clippedItems.filter((i) => i.decorative).length,
      items: clippedItems.slice(0, 30),
    },
    overlaps: { count: pairs.length, items: overlapItems },
    fitRepairs,
    images: {
      count: imageItems.length,
      broken: imageItems.filter((i) => i.broken).length,
      blurry: imageItems.filter((i) => i.blurry).length,
      maxUpscale: upscales.length ? Math.max(...upscales) : null,
      items: imageItems.slice(0, 40),
    },
    fonts,
    fontFallbacks: fallbacks,
    counts: raw.counts,
    menu: raw.menu,
    contrast: {
      measured: samples.length,
      min: samples[0]?.ratio ?? null,
      belowAA: samples.filter((s) => s.ratio < 4.5).length,
      belowAAA: samples.filter((s) => s.ratio < 7).length,
      occluded: samples.filter((s) => s.occluded).length,
      // Occluded text first (it is invisible whatever its ratio), then worst ratio.
      items: [...samples.filter((s) => s.occluded), ...samples.filter((s) => !s.occluded)].slice(0, 40),
    },
    emptySpace: {
      cols: grid.cols,
      rows: grid.rows,
      emptyCells: grid.emptyCells,
      ratio: round3(grid.ratio),
      target: EMPTY_TARGET,
      overTarget: grid.ratio > EMPTY_TARGET,
      largestVoidCells: grid.largestVoidCells,
      largestVoidPct: round3(grid.largestVoidPct),
      map: grid.map,
    },
    blockedRequests: blockedUnique.slice(0, 100),
    blockedRequestCount: blockedUnique.length,
    pageErrors: input.pageErrors.slice(0, 20),
    warnings,
  };
}
