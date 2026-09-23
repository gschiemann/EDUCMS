/**
 * What the in-page measurement pass hands back to Node: raw geometry in
 * VIEWPORT px and computed styles in the element's own CSS px, plus the
 * scale between the two. All unit conversion and every judgement (floors,
 * thresholds, tiers, overlaps, contrast) happens in Node, where it is pure
 * and unit-tested — the page only observes.
 */
import type { ElementCounts, MenuMetrics } from '../contract.js';

/** Viewport-px rectangle. */
export interface VRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RawColor {
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

export interface RawText {
  id: number;
  field: string | null;
  selector: string;
  text: string;
  /** Non-whitespace characters in the element's own text. */
  chars: number;
  /** Computed font-size, the element's CSS px. */
  fontSizeCss: number;
  /** Viewport px per CSS px for this element (the transform chain, incl. stage scale). */
  scale: number;
  primaryFamily: string;
  familyList: string;
  weight: string;
  style: string;
  /** Effective text fill (color or -webkit-text-fill-color) with alpha × effective opacity. null = not a flat colour. */
  fill: RawColor | null;
  opacity: number;
  ariaHidden: boolean;
  /** Stroke, shadow or background-clip:text — the pixel read is less exact. */
  effects: boolean;
  /** Glyph (ink) boxes, one per line fragment, before clipping. */
  inkRects: VRect[];
  /** Ink ∩ every clipping ancestor ∩ the viewport. */
  visibleRects: VRect[];
  inkArea: number;
  visibleArea: number;
  /** Visible spill past its own box (or that box's parent). */
  boxOverflow: { selector: string; top: number; right: number; bottom: number; left: number } | null;
  /** The innermost clipper that hides part of the ink. */
  clip: {
    kind: 'self' | 'ancestor' | 'ellipsis';
    selector: string;
    top: number;
    right: number;
    bottom: number;
    left: number;
    /** The clipper IS the canvas (a stage div the size of the viewport). */
    coversViewport: boolean;
    /** No ink survives the clip at all. */
    fullyHidden: boolean;
    /** …but it sits within one font size of the clip edge (pushed out, not parked off-screen). */
    nearEdge: boolean;
  } | null;
  /** How far the ink extends past each viewport edge (0 when inside). */
  stage: { top: number; right: number; bottom: number; left: number };
}

export interface RawImage {
  kind: 'img' | 'background';
  selector: string;
  slot: string | null;
  src: string;
  naturalW: number;
  naturalH: number;
  broken: boolean;
  vector: boolean;
  /** Positioning area / content box, element CSS px. */
  boxW: number;
  boxH: number;
  /** Viewport px per CSS px. */
  scale: number;
  /** object-fit (img) or this layer's background-size (background). */
  fit: string;
  /** The element box ∩ viewport, viewport px (null when off-canvas). */
  rect: VRect | null;
  visible: boolean;
}

export interface RawFit {
  vosFs: Array<{ field: string | null; selector: string; text: string; originalCss: number; currentCss: number; scale: number }>;
  vgw: Array<{ selector: string; originalW: number; originalH: number; currentW: number; currentH: number; dimmed: boolean; scale: number }>;
  fitCol: Array<{ selector: string; field: string | null; scale: number }>;
  dataFit: Array<{ field: string | null; selector: string; text: string; authoredCss: number; renderedCss: number; scale: number }>;
}

export interface RawFontFace {
  family: string;
  style: string;
  weight: string;
  status: string;
}

export interface RawProbe {
  probe: number;
  textId: number;
  signature: string;
}

export interface RawPageMeasure {
  viewport: { width: number; height: number; dpr: number };
  texts: RawText[];
  textLimitHit: boolean;
  images: RawImage[];
  fit: RawFit;
  counts: ElementCounts;
  menu: MenuMetrics;
  fontFaces: RawFontFace[];
  probes: RawProbe[];
  warnings: string[];
}

/** Everything the preload script collected while the page ran. */
export interface RawPageLog {
  csp: Array<{ uri: string; directive: string }>;
  popups: string[];
  frozenAnimations: number;
}

export interface MeasureArgs {
  /** Attribute that marks font-probe elements (per-render nonce). */
  probeAttr: string;
  /** Cap on text elements measured. */
  maxTexts: number;
  /** Cap on images measured. */
  maxImages: number;
  /** Background-image natural-size load timeout. */
  imageTimeoutMs: number;
}
