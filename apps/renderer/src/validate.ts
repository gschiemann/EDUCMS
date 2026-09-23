/**
 * Validate a `POST /render` body. Pure. A request that fails here never
 * reaches Chromium.
 */
import { RENDER_DEFAULTS, RENDER_LIMITS, type RenderRequest } from './contract.js';

export type ValidRenderRequest = Required<RenderRequest>;

export type Validation = { ok: true; value: ValidRenderRequest } | { ok: false; message: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function intIn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

export function validateRenderRequest(body: unknown, maxHtmlChars: number = RENDER_LIMITS.maxBodyBytes): Validation {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be a JSON object' };
  const { html, canvasWidth, canvasHeight } = body;
  if (typeof html !== 'string' || html.trim().length === 0) return { ok: false, message: '`html` must be a non-empty string' };
  if (html.length > maxHtmlChars) return { ok: false, message: `\`html\` exceeds ${maxHtmlChars} characters` };
  if (!/<[a-z!]/i.test(html)) return { ok: false, message: '`html` must be an HTML document' };
  const { canvasMinPx: cmin, canvasMaxPx: cmax } = RENDER_LIMITS;
  if (!intIn(canvasWidth, cmin, cmax)) return { ok: false, message: `\`canvasWidth\` must be an integer in [${cmin}, ${cmax}]` };
  if (!intIn(canvasHeight, cmin, cmax)) return { ok: false, message: `\`canvasHeight\` must be an integer in [${cmin}, ${cmax}]` };

  const viewportScale = body.viewportScale ?? RENDER_DEFAULTS.viewportScale;
  if (
    typeof viewportScale !== 'number' ||
    !Number.isFinite(viewportScale) ||
    viewportScale < RENDER_LIMITS.viewportScaleMin ||
    viewportScale > RENDER_LIMITS.viewportScaleMax
  ) {
    return { ok: false, message: `\`viewportScale\` must be a number in [${RENDER_LIMITS.viewportScaleMin}, ${RENDER_LIMITS.viewportScaleMax}]` };
  }
  const settleMs = body.settleMs ?? RENDER_DEFAULTS.settleMs;
  if (!intIn(settleMs, 0, RENDER_LIMITS.settleMsMax)) {
    return { ok: false, message: `\`settleMs\` must be an integer in [0, ${RENDER_LIMITS.settleMsMax}]` };
  }
  const fullWidth = body.fullWidth ?? RENDER_DEFAULTS.fullWidth;
  if (!intIn(fullWidth, RENDER_LIMITS.fullWidthMin, RENDER_LIMITS.fullWidthMax)) {
    return { ok: false, message: `\`fullWidth\` must be an integer in [${RENDER_LIMITS.fullWidthMin}, ${RENDER_LIMITS.fullWidthMax}]` };
  }
  const vw = Math.round(canvasWidth * viewportScale);
  const vh = Math.round(canvasHeight * viewportScale);
  if (vw < 16 || vh < 16) return { ok: false, message: 'the viewport (canvas × viewportScale) is smaller than 16 px' };
  if (vw * vh > RENDER_LIMITS.maxViewportPixels) {
    return { ok: false, message: `the viewport (canvas × viewportScale = ${vw}×${vh}) exceeds a 4K frame` };
  }
  return { ok: true, value: { html, canvasWidth, canvasHeight, viewportScale, settleMs, fullWidth } };
}
