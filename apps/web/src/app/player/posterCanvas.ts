/**
 * LED poster canvas derivation — pure, no DOM, no network (2026-09-01).
 *
 * THE PROBLEM. A NovaStar TB poster (Rockchip rk356x_box, Chromium 83) shows
 * the TOP-LEFT region of its Android OS canvas on the LED, point-to-point.
 * The OS resolution is set in ViPlex Express, floors at 600 wide and ships at
 * 1920×1080, while a single poster module is 320×1080 (the 1.86 mm fleet
 * standard) or another size per pixel pitch (1.56 mm ≈ 360×1200). Nothing on
 * the controller can report the LED size to the app. So:
 *   • before pairing there is no tenant, no dashboard value and no way to
 *     know the module — the install status and the pairing code must draw
 *     inside a column every poster can show;
 *   • after pairing, a single poster must render to its module size even
 *     though the OS canvas is wider, while a chain (2–6 panels) must follow
 *     the OS width the operator set in ViPlex for exactly that purpose.
 *
 * THE RULE (one function, both phases):
 *   1. An explicit canvas (dashboard LED canvas / on-device "Resize for LED")
 *      always wins. Not this module's business — the caller passes it and it
 *      is returned as-is.
 *   2. Not a poster-class box → null: the OS resolution governs, as it always
 *      has for every LCD and every other player.
 *   3. Poster class, OS width a clean multiple of the standard width and
 *      larger than it → a chain: { osWidth × standard height }. The operator
 *      set that width in ViPlex on purpose.
 *   4. Poster class, anything else (600 = the controller's floor, 1920 = the
 *      factory default, or an unrelated width) → a single poster at the
 *      standard size.
 *
 * The derived value is NEVER persisted by callers (see page.tsx): only an
 * explicit canvas is written to storage, so this rule can never fight a
 * value the operator set later.
 */

export interface PosterSize {
  w: number;
  h: number;
}

/** The fleet standard: a 1.86 mm single-panel poster. */
export const DEFAULT_POSTER_STANDARD: PosterSize = { w: 320, h: 1080 };

/** The widest chain the dashboard offers (6 panels). */
export const MAX_POSTER_PANELS = 6;

/**
 * OS widths a controller ships with. A fresh box at 1920×1080 is a SINGLE
 * poster until someone says otherwise — 6 × 320 = 1920 is the one ambiguous
 * width, and defaulting it to a 6-panel chain would cut every new poster to
 * a sixth of its layout. A real 6-panel chain is set explicitly in the
 * dashboard (one click on "6").
 */
export const FACTORY_OS_WIDTHS: ReadonlySet<number> = new Set([1920, 3840]);

/**
 * True for the NovaStar TB poster class. The WebView UA on those boxes is
 *   "Mozilla/5.0 (Linux; Android 11; rk356x_box Build/…; wv) … Chrome/83…"
 * — NovaStar leaves the Rockchip reference strings in place and carries no
 * "Taurus"/"NovaStar" marker (mirrors apps/api/src/screens/hardware-detect.ts).
 * A "Taurus"/"NovaStar" marker still counts for firmware that carries one.
 */
export function isPosterClassUserAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent || '').toLowerCase();
  if (!ua) return false;
  return (
    ua.includes('rk356x_box') ||
    ua.includes('rk3568') ||
    ua.includes('taurus') ||
    ua.includes('novastar') ||
    ua.includes('nova-star')
  );
}

/** Normalize a candidate standard: positive integers only, else the default. */
export function normalizePosterStandard(
  candidate: Partial<PosterSize> | null | undefined,
): PosterSize {
  const w = Number(candidate?.w);
  const h = Number(candidate?.h);
  if (Number.isFinite(w) && Number.isFinite(h) && w >= 32 && h >= 32 && w <= 8192 && h <= 8192) {
    return { w: Math.round(w), h: Math.round(h) };
  }
  return DEFAULT_POSTER_STANDARD;
}

export interface DerivePosterCanvasInput {
  /** Poster-class box (see isPosterClassUserAgent / manifest hardwareModel). */
  posterClass: boolean;
  /** The OS canvas the controller reports (`?w=&h=` on the player URL). */
  osW: number | null | undefined;
  osH: number | null | undefined;
  /** An explicit canvas from the dashboard or the on-device editor. */
  explicit?: Partial<PosterSize> | null;
  /** The tenant's standard module size; the default when unknown (pre-pair). */
  standard?: Partial<PosterSize> | null;
}

export interface DerivedPosterCanvas extends PosterSize {
  /** Why this size: the operator's value, a ViPlex chain, or the standard. */
  source: 'explicit' | 'chain' | 'standard';
  /** Panels across, for the chain and standard cases. */
  panels: number;
}

/**
 * Derive the canvas a poster-class player should draw to, or null when the
 * OS resolution should govern (every non-poster box).
 */
export function derivePosterCanvas(input: DerivePosterCanvasInput): DerivedPosterCanvas | null {
  const ex = input.explicit;
  const exW = Number(ex?.w);
  const exH = Number(ex?.h);
  if (Number.isFinite(exW) && Number.isFinite(exH) && exW > 0 && exH > 0) {
    return { w: Math.round(exW), h: Math.round(exH), source: 'explicit', panels: 0 };
  }
  if (!input.posterClass) return null;
  const std = normalizePosterStandard(input.standard);
  const osW = Number(input.osW);
  if (
    Number.isFinite(osW) &&
    osW > std.w &&
    osW % std.w === 0 &&
    osW / std.w <= MAX_POSTER_PANELS &&
    !FACTORY_OS_WIDTHS.has(osW)
  ) {
    return { w: osW, h: std.h, source: 'chain', panels: osW / std.w };
  }
  return { w: std.w, h: std.h, source: 'standard', panels: 1 };
}
