/**
 * contract.ts — the renderer's wire contract, and nothing else.
 *
 * DEPENDENCY-FREE ON PURPOSE. No imports, no runtime code beyond a handful of
 * constants, so the API can import this file or copy it verbatim into its own
 * tree without dragging the renderer's module graph (puppeteer, sharp, the
 * bundled fonts) anywhere near the process that owns emergency delivery.
 * If you copy it, copy it whole and keep `RENDER_CONTRACT_VERSION` in step:
 * the renderer stamps that number on every answer and the caller should refuse
 * one it does not recognise.
 *
 * UNITS. Every length in `RenderMetrics` is in CANVAS px — the board's design
 * space (3840 × 2160 for a 4K landscape board) — whatever viewport the page was
 * actually rendered at. A 94 px canvas headline reads 94 here even though the
 * 1920 × 1080 screenshot drew it 47 px tall. Percentages of the canvas SHORT
 * side are given where the design rubric states its thresholds that way
 * (docs/research/2026-09-22-ai-designer-rework/03-render-critique-async.md §3).
 *
 * TRUST. The metrics are measurements of a document the caller supplied and
 * that ran its own CSS (and, for legacy boards, its own script). A hostile
 * board can make itself look better than it is. Treat every number as
 * evidence for the critique, never as an authorisation decision.
 */

/** Bumped only when a field changes meaning or disappears. Additive changes keep it. */
export const RENDER_CONTRACT_VERSION = 1 as const;

// ─────────────────────────────────────────────────────────────────────────
// Request
// ─────────────────────────────────────────────────────────────────────────

/** `POST /render` body. JSON, `Content-Type: application/json`, ≤ `RENDER_LIMITS.maxBodyBytes`. */
export interface RenderRequest {
  /**
   * A COMPLETE HTML document, exactly as a screen would receive it — the API
   * assembles it (board + fit engine + stage-scale runtime + its CSP).
   *
   * Every image must already be a `data:` URI: the renderer has no network,
   * so an `https://` image is BLOCKED and reported, never fetched. Google
   * Fonts `<link>`s are fine — they are answered from fonts bundled in the
   * image (see `metrics.fontFallbacks` for anything that could not be).
   */
  html: string;
  /** Design canvas width in px (e.g. 3840). */
  canvasWidth: number;
  /** Design canvas height in px (e.g. 2160). */
  canvasHeight: number;
  /**
   * Viewport = canvas × this. Default 0.5 (a 3840 × 2160 board renders at
   * 1920 × 1080 — exactly what a 1080p screen shows).
   */
  viewportScale?: number;
  /**
   * How long to let the board settle after `load` before freezing it and
   * shooting. Default 2200 ms: the fit engine re-runs at 400 / 1200 / 2000 ms.
   */
  settleMs?: number;
  /** Width of the returned `image` in px (the height keeps the aspect). Default 1920. */
  fullWidth?: number;
}

export const RENDER_DEFAULTS = {
  viewportScale: 0.5,
  settleMs: 2200,
  fullWidth: 1920,
  thumbWidth: 480,
  webpQuality: 82,
  thumbQuality: 70,
} as const;

export const RENDER_LIMITS = {
  /** Request body cap. Larger → 413. */
  maxBodyBytes: 4 * 1024 * 1024,
  canvasMinPx: 64,
  canvasMaxPx: 8192,
  viewportScaleMin: 0.1,
  viewportScaleMax: 1,
  /** The rendered viewport may not exceed a 4K frame (width × height). */
  maxViewportPixels: 3840 * 2160,
  settleMsMax: 10_000,
  fullWidthMin: 160,
  fullWidthMax: 3840,
  /** Wall clock for one render (browser time, excluding queue wait). Over → 504. */
  renderTimeoutMs: 30_000,
  /** Renders waiting behind the one in flight. More → 429. */
  queueMax: 4,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Response
// ─────────────────────────────────────────────────────────────────────────

/** `POST /render` 200 body. */
export interface RenderResponse {
  contractVersion: typeof RENDER_CONTRACT_VERSION;
  /** Base64 WebP, `imageWidth` wide (= request `fullWidth`). */
  image: string;
  imageWidth: number;
  imageHeight: number;
  /** Base64 WebP, 480 px wide — for the picker grid. */
  thumb: string;
  thumbWidth: number;
  thumbHeight: number;
  metrics: RenderMetrics;
  timings: RenderTimings;
  /** e.g. "HeadlessChrome/140.0.7339.0" — which engine drew this. */
  chromium: string;
}

/** Milliseconds per phase. `totalMs` is request-in to response-out. */
export interface RenderTimings {
  queueMs: number;
  /** Launching Chromium, when this render had to (0 on a warm browser). */
  launchMs: number;
  /** Context + page + navigation to the `load` event. */
  loadMs: number;
  /** Waiting for `document.fonts.ready` (bounded). */
  fontsMs: number;
  /** The settle window actually waited. */
  settleMs: number;
  screenshotMs: number;
  /** The in-page measurement pass. */
  measureMs: number;
  /** The second, glyph-less frame contrast is read against. */
  backplateMs: number;
  /** Asking Chromium which platform font drew each family (bounded, best effort). */
  fontProbeMs: number;
  /** Pixel analysis: contrast samples + empty-space grid. */
  analyzeMs: number;
  /** WebP encode of image + thumb. */
  encodeMs: number;
  totalMs: number;
}

/** Every error body has this shape, whatever the status. */
export interface RenderErrorBody {
  contractVersion: typeof RENDER_CONTRACT_VERSION;
  error: RenderErrorCode;
  message: string;
}

export type RenderErrorCode =
  | 'invalid_json'
  | 'invalid_request'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'queue_full'
  | 'render_timeout'
  | 'render_failed'
  | 'browser_unavailable'
  | 'memory_limit'
  | 'shutting_down'
  | 'not_found'
  | 'method_not_allowed';

/** The HTTP status each error code travels with. */
export const RENDER_ERROR_STATUS: Record<RenderErrorCode, number> = {
  invalid_json: 400,
  invalid_request: 400,
  unsupported_media_type: 415,
  payload_too_large: 413,
  queue_full: 429,
  render_timeout: 504,
  render_failed: 500,
  browser_unavailable: 503,
  memory_limit: 503,
  shutting_down: 503,
  not_found: 404,
  method_not_allowed: 405,
};

/** `GET /health` 200 body (503 with `status: 'error'` when Chromium cannot start). */
export interface HealthResponse {
  status: 'ok' | 'error';
  chromium: string | null;
  contractVersion: typeof RENDER_CONTRACT_VERSION;
  uptimeS: number;
  rendersServed: number;
  queue: { active: number; waiting: number; max: number };
  memoryMb: number | null;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────────────────────

/** Canvas-px rectangle. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Which piece of text a finding is about. `field` is the nearest `data-field`
 * (the element's own or an ancestor's) — the handle the critic's patches and
 * the builder's click-to-edit already speak. `selector` is a short CSS path for
 * text that carries no field.
 */
export interface TextRef {
  field: string | null;
  selector: string;
  /** The element's own text, whitespace-collapsed, ≤ 60 chars. */
  text: string;
  /** Rendered font size in canvas px (computed size × any transform scale). */
  fontPx: number;
  /**
   * aria-hidden, or effective opacity < 0.2: ornament rather than copy. Kept
   * in item lists (flagged) but excluded from every summary count.
   */
  decorative: boolean;
}

export interface TextMetrics {
  /** Visible, non-decorative text elements measured. */
  elements: number;
  decorativeElements: number;
  characters: number;
  /** The legibility floor the rubric uses: 2.4 % of the canvas short side (52 px at 2160). */
  floorPx: number;
  minFont: (TextRef & { pctShortSide: number }) | null;
  belowFloorCount: number;
  /** Smallest first, ≤ 20. */
  belowFloor: TextRef[];
  /** Distinct rendered sizes (clustered within 5 %), largest first. */
  sizeTiers: Array<{ px: number; elements: number; characters: number }>;
  largestPx: number | null;
  /** largest tier ÷ second tier — the "one focal point" signal. */
  topTwoRatio: number | null;
}

export interface OverflowItem extends TextRef {
  /**
   * 'box': the text runs out of its own box (or that box's parent) and the
   *        spill-over is VISIBLE on screen.
   * 'stage': part of the text lies outside the canvas.
   */
  kind: 'box' | 'stage';
  /** Furthest excursion past the edge, canvas px. */
  overflowPx: number;
  sides: Array<'top' | 'right' | 'bottom' | 'left'>;
  /** The box it escapes (for 'box'). */
  boxSelector: string | null;
}

export interface ClippedItem extends TextRef {
  /**
   * 'self': cut off by its own box's overflow (hidden/clip/scroll/auto).
   * 'ancestor': cut off by an ancestor's.
   * 'ellipsis': text-overflow: ellipsis or -webkit-line-clamp is truncating it.
   */
  kind: 'self' | 'ancestor' | 'ellipsis';
  /** Furthest distance the hidden ink extends past the clip edge, canvas px. */
  clippedPx: number;
  /** Share of the text's ink area that is hidden, 0–1. */
  hiddenFraction: number;
  clipSelector: string;
}

export interface OverlapItem {
  a: TextRef;
  b: TextRef;
  /** Size of the largest glyph-box intersection, canvas px (both > 6 to count). */
  overlapW: number;
  overlapH: number;
  /** Both runs carry identical text — usually a deliberate layered effect. */
  identicalText: boolean;
}

export interface FitRepairs {
  /** `data-vos-fs`: the fit engine rescaled this text (Pass C / floor-up). */
  textScaled: {
    count: number;
    minScale: number | null;
    items: Array<{ field: string | null; selector: string; text: string; originalPx: number; currentPx: number; scale: number }>;
  };
  /** `data-vos-fs` entries whose text was RAISED to the legibility floor. */
  raisedToFloor: number;
  /** `data-vgw`: a decoration the guard shrank and/or dimmed because it covered text. */
  decorations: {
    count: number;
    dimmed: number;
    minScale: number | null;
    items: Array<{ selector: string; originalW: number; originalH: number; currentW: number; currentH: number; scale: number; dimmed: boolean }>;
  };
  /** `data-fit-col`: a column the stage-scale runtime shrank to fit. */
  columns: {
    count: number;
    minScale: number | null;
    items: Array<{ selector: string; field: string | null; scale: number }>;
  };
  /** `data-fit` text rendered smaller than its stylesheet size (a fit pass shrank it). */
  dataFit: {
    count: number;
    minScale: number | null;
    items: Array<{ field: string | null; selector: string; text: string; authoredPx: number; renderedPx: number; scale: number }>;
  };
  /** Any repair scale below 0.9 — the board is overcrowded. */
  overcrowded: boolean;
}

export interface ImageItem {
  kind: 'img' | 'background';
  selector: string;
  /** `data-imgslot` / `data-img` of the element, when it has one. */
  slot: string | null;
  /** The source, truncated; a data: URI is summarised as `data:<mime> (<KB> KB)`. */
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Size the bitmap is DRAWN at (after object-fit / background-size), canvas px. */
  drawnWidth: number;
  drawnHeight: number;
  /** drawn ÷ natural along the more-stretched axis. null when broken or vector. */
  upscale: number | null;
  /** upscale > 1.3 — softer than the screen can show. */
  blurry: boolean;
  broken: boolean;
  vector: boolean;
  /** object-fit: fill stretching — larger axis scale ÷ smaller; 1 = undistorted. */
  distortion: number | null;
  /** Some of it is on the canvas and not transparent. */
  visible: boolean;
}

export interface ImageMetrics {
  count: number;
  broken: number;
  blurry: number;
  maxUpscale: number | null;
  items: ImageItem[];
}

export interface FontFamilyUsage {
  /** The family the CSS asked for first. */
  family: string;
  /**
   * 'webfont'     — a bundled Google font, and it drew the text.
   * 'substituted' — a system face the renderer does not ship (Impact, Arial…),
   *                 drawn with a bundled look-alike (`servedAs`) so the shot
   *                 shows the INTENDED design. A screen that lacks the face
   *                 (every Android player lacks Impact) draws its own
   *                 fallback instead — treat this as "not a DESIGNER_FONTS
   *                 family", not as "fine".
   * 'system'      — a system font, and that font drew the text.
   * 'generic'     — a generic family (sans-serif, serif, system-ui…).
   * 'fallback'    — NOT drawn with the requested face; see `fontFallbacks`.
   * 'unverified'  — no platform-font evidence was collected for it.
   */
  status: 'webfont' | 'substituted' | 'system' | 'generic' | 'fallback' | 'unverified';
  servedAs: string | null;
  /** Platform font names that actually drew its glyphs, most-used first. */
  renderedWith: string[];
  elements: number;
  characters: number;
}

export interface FontFallback {
  family: string;
  reason: 'not-bundled' | 'load-failed' | 'not-installed' | 'google-fonts-error' | 'blocked';
  /** Whether any visible text asked for it. */
  usedInText: boolean;
  renderedWith: string[];
  detail: string | null;
}

export interface ElementCounts {
  dataField: number;
  dataImgslot: number;
  dataMenuRow: number;
  dataPosItem: number;
  dataAction: number;
}

export interface MenuMetrics {
  /** `[data-menu-row]` elements. */
  rows: number;
  rowsVisible: number;
  rowsWithNameAndPrice: number;
  /** Visible rows missing a visible name and/or price (≤ 20). */
  rowProblems: Array<{ selector: string; field: string | null; missing: Array<'name' | 'price'> }>;
  /** `[data-pos-item]` elements. */
  posItems: number;
  /** Distinct `item.N` groups among `data-field`s (the POS row contract). */
  items: number;
  /** …whose `item.N.name` AND `item.N.price` are both visibly rendered. */
  itemsWithNameAndPrice: number;
}

/**
 * Measured from two frames of the frozen board: as shown, and with every
 * glyph fill transparent (the "backplate"). The backplate under a text box is
 * exactly its background, so there is no guessing which pixels are text.
 */
export interface ContrastSample extends TextRef {
  /** Text vs the dominant background colour under its glyph boxes. */
  ratio: number;
  /** Text vs the worst 10 % of the background under it (a photo's bright patch). */
  minRatio: number;
  /** `#rrggbb`: the text colour as composited, and the dominant background. */
  fg: string;
  bg: string;
  samples: number;
  /** Share of its box the text actually inked. */
  inkShare: number;
  /** It should show but drew (almost) nothing — something is painted over it. */
  occluded: boolean;
  /** Shadow / stroke / gradient-fill text: the flat-colour ratio understates or guesses. */
  effects: boolean;
}

export interface ContrastMetrics {
  measured: number;
  /** Lowest `ratio` among non-decorative text. */
  min: number | null;
  /** Non-decorative samples under 4.5:1 / 7:1. */
  belowAA: number;
  belowAAA: number;
  /** Non-decorative text drawn under something else. */
  occluded: number;
  /** Worst first, ≤ 40. */
  items: ContrastSample[];
}

export interface EmptySpaceMetrics {
  cols: number;
  rows: number;
  /** Cells that are one flat colour with no text or image on them. */
  emptyCells: number;
  /** emptyCells ÷ (cols × rows). */
  ratio: number;
  /** The rubric's target: ratio ≤ 0.35. */
  target: number;
  overTarget: boolean;
  /** Largest 4-connected run of empty cells. */
  largestVoidCells: number;
  /** …as a share of the canvas. The rubric flags a single void over ~12 %. */
  largestVoidPct: number;
  /** One string per grid row: '.' empty, '#' used. */
  map: string[];
}

export interface BlockedRequest {
  /** Truncated to 200 chars; data: never appears (it is allowed). */
  url: string;
  /** Chromium resource type, or the CSP directive for 'csp'. */
  type: string;
  /**
   * 'network'    — a fetch/image/stylesheet/script to anywhere but the bundle.
   * 'navigation' — the document tried to navigate itself or a frame away.
   * 'csp'        — refused by a Content-Security-Policy before it was sent.
   * 'popup'      — tried to open a new window.
   * 'font'       — a font URL that is not in the bundle.
   */
  reason: 'network' | 'navigation' | 'csp' | 'popup' | 'font';
}

export interface RenderMetrics {
  canvas: {
    width: number;
    height: number;
    shortSide: number;
    viewportWidth: number;
    viewportHeight: number;
    viewportScale: number;
    devicePixelRatio: number;
  };
  text: TextMetrics;
  overflow: { count: number; decorativeCount: number; items: OverflowItem[] };
  clipped: { count: number; decorativeCount: number; items: ClippedItem[] };
  /** Glyph boxes intersecting by > 6 canvas px on both axes (decorative text excluded). */
  overlaps: { count: number; items: OverlapItem[] };
  fitRepairs: FitRepairs;
  images: ImageMetrics;
  fonts: FontFamilyUsage[];
  fontFallbacks: FontFallback[];
  counts: ElementCounts;
  menu: MenuMetrics;
  contrast: ContrastMetrics;
  emptySpace: EmptySpaceMetrics;
  /** Deduplicated, ≤ 100 (see `blockedRequestCount` for the true total). */
  blockedRequests: BlockedRequest[];
  blockedRequestCount: number;
  /** Uncaught page exceptions, ≤ 20, truncated. */
  pageErrors: string[];
  /** Anything the renderer could not measure fully, in plain words. */
  warnings: string[];
}
