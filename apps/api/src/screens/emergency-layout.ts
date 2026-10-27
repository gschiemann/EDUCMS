/**
 * Which emergency board ORIENTATION a screen plays (portrait or landscape).
 *
 * ONE rule for every reader (2026-10-26, the live alerts at a launch site):
 * the manifest's emergency branch, the trigger's per-screen override rows
 * (location mode writes the resolved playlist per screen) and the staged
 * boards the player pre-fetches. Two of those used to disagree with this
 * function — the trigger read the OS resolution alone — so:
 *   • the BACK face of a double-sided unit (`orientation: 'PORTRAIT'`, but its
 *     panel reports a landscape mode such as 960×540) was written the
 *     LANDSCAPE board while the front got the portrait one;
 *   • an LED poster (NovaStar TB: OS canvas 1920×1080, the LED itself a
 *     320×1080 module) was written the landscape board for a portrait panel.
 *
 * Precedence: an explicit LED canvas → the poster-class rule → a face's own
 * orientation → the OS resolution. Existing primary/LED precedence is
 * unchanged. A Presentation's CSS resolution can be landscape even when its
 * own configured/rotated face is portrait.
 */
export interface EmergencyLayoutScreen {
  canvasW?: number | null;
  canvasH?: number | null;
  orientation?: string | null;
  resolution?: string | null;
  faceOfScreenId?: string | null;
  /** `novastar-taurus` is the LED poster class (hardware-detect.ts). */
  hardwareModel?: string | null;
}

/** The tenant's standard poster module (Tenant.posterStandardW/H); the fleet default when unset. */
export interface PosterStandard {
  w: number;
  h: number;
}
export const DEFAULT_POSTER_STANDARD: PosterStandard = { w: 320, h: 1080 };
/** The widest ViPlex chain the dashboard offers (mirrors apps/web/src/app/player/posterCanvas.ts). */
const MAX_POSTER_PANELS = 6;
/** OS widths a controller ships with: a fresh 1920-wide box is a SINGLE poster. */
const FACTORY_OS_WIDTHS: ReadonlySet<number> = new Set([1920, 3840]);

export function isPosterClassModel(
  hardwareModel: string | null | undefined,
): boolean {
  return hardwareModel === 'novastar-taurus';
}

function parseResolution(
  resolution: string | null | undefined,
): { w: number; h: number } | null {
  const m = (resolution || '').trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/**
 * The LED canvas a poster-class box draws to, derived from its OS resolution
 * — the SAME rule as the player's `derivePosterCanvas` (posterCanvas.ts):
 * a clean multiple of the standard width (not a factory width) is a ViPlex
 * chain of that width; anything else is one module at the standard size.
 * Null for every other box (the OS resolution governs, as it always has).
 */
export function posterClassCanvas(
  screen: Pick<EmergencyLayoutScreen, 'hardwareModel' | 'resolution'>,
  standard: PosterStandard | null | undefined,
): { w: number; h: number } | null {
  if (!isPosterClassModel(screen.hardwareModel)) return null;
  const sw = Number(standard?.w),
    sh = Number(standard?.h);
  const std =
    Number.isFinite(sw) &&
    Number.isFinite(sh) &&
    sw >= 32 &&
    sh >= 32 &&
    sw <= 8192 &&
    sh <= 8192
      ? { w: Math.round(sw), h: Math.round(sh) }
      : DEFAULT_POSTER_STANDARD;
  const os = parseResolution(screen.resolution);
  const osW = os?.w ?? NaN;
  if (
    Number.isFinite(osW) &&
    osW > std.w &&
    osW % std.w === 0 &&
    osW / std.w <= MAX_POSTER_PANELS &&
    !FACTORY_OS_WIDTHS.has(osW)
  ) {
    return { w: osW, h: std.h };
  }
  return { w: std.w, h: std.h };
}

export function emergencyLayoutIsPortrait(
  screen: EmergencyLayoutScreen,
  posterStandard?: PosterStandard | null,
): boolean {
  const w = Number(screen.canvasW),
    h = Number(screen.canvasH);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return h > w;
  const poster = posterClassCanvas(screen, posterStandard);
  if (poster) return poster.h > poster.w;
  if (screen.faceOfScreenId) {
    if (screen.orientation === 'PORTRAIT') return true;
    if (screen.orientation === 'LANDSCAPE') return false;
  }
  const resolution = parseResolution(screen.resolution);
  return !!resolution && resolution.h > resolution.w;
}

export function emergencyLayoutOrientation(
  screen: EmergencyLayoutScreen,
  posterStandard?: PosterStandard | null,
) {
  const portrait = emergencyLayoutIsPortrait(screen, posterStandard);
  return screen.faceOfScreenId
    ? portrait
      ? 'PORTRAIT'
      : 'LANDSCAPE'
    : portrait
      ? 'portrait'
      : 'landscape';
}
