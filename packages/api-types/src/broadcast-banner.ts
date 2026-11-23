/**
 * Broadcast banner options (2026-11-01) — the sender's choice of colour,
 * motion and (2026-11-23) text size for an INFO / WARN text broadcast, shared
 * by the API (validation, storage, delivery), the composer preview and the
 * player so all three agree byte for byte.
 *
 * Stored on `EmergencyMessage.bannerStyle` and carried as `banner` in BOTH the
 * signed TEXT_BROADCAST push and the device poll (`GET /emergency/messages`),
 * so a screen that missed the push renders the same banner.
 *
 * SAFE BY CONSTRUCTION: a missing, malformed or hostile value sanitises to
 * `null` ("today's look"). An older player never reads the field at all.
 * The CRITICAL full-screen alert and every lockdown-class override ignore
 * it — red stays the life-safety signal.
 *
 * TEXT SIZE (2026-11-23): `size` is small / medium / large; MEDIUM IS THE
 * ABSENCE OF THE KEY. The canonical form carries `size` only for small or
 * large, so every message stored before the field existed, and every new
 * medium one, is byte for byte what it was (same row, same signed payload,
 * same poll answer, same paint identity). Compatibility both ways:
 *   - an older player given a small / large message ignores the key it does
 *     not know and draws medium (its sanitiser copies only colour, mode and
 *     speed);
 *   - a newer player given an older message (no `size`) draws medium.
 * Deploy order: the strict input schema of an API from before this change
 * refuses a `size` key, so a Small / Large send that reaches the previous API
 * build is answered 400 before anything is written or sent. A Medium send
 * carries no `size` and is accepted by both builds.
 *
 * SPEED (2026-11-23): slowed after the owner found even "slow" too fast —
 * one stage width every 48 s / 30 s / 20 s (was 20 s / 12 s / 7.5 s), and the
 * marquee now actually runs at that speed for every message length (see
 * `bannerLoopSeconds`: a short message used to run 2-3x the table). The
 * stored values stay `slow` / `normal` / `fast`, so stored messages and older
 * players stay valid; an older player keeps its own (faster) behaviour.
 *
 * PURE — no DOM, no Node.
 */
import { z } from 'zod';

export const BANNER_MODES = ['static', 'scroll'] as const;
export type BannerMode = (typeof BANNER_MODES)[number];
export const BANNER_SPEEDS = ['slow', 'normal', 'fast'] as const;
export type BannerSpeed = (typeof BANNER_SPEEDS)[number];

/**
 * Marquee speed in canvas-relative terms: stage widths crossed per minute.
 * 1.25 / 2 / 3 = one stage width every 48 s / 30 s / 20 s; on a 1920 px stage
 * that is 40 / 64 / 96 px per second, on a 3840 px stage 80 / 128 / 192
 * (the same speed relative to the screen). The new "fast" is the old "slow".
 */
export const BANNER_SPEED_STAGES_PER_MIN: Record<BannerSpeed, number> = {
  slow: 1.25,
  normal: 2,
  fast: 3,
};

/**
 * The shortest time one loop of the marquee may take (seconds). A loop is at
 * least as wide as the bar, so on any real stage this never binds; it only
 * ever SLOWS a degenerate case, never speeds one up.
 */
export const BANNER_MIN_LOOP_SECONDS = 4;

/** Marquee pixels per second on a stage `stageWidth` CSS px wide. */
export function bannerPxPerSecond(stageWidth: number, speed: BannerSpeed): number {
  const stages = BANNER_SPEED_STAGES_PER_MIN[speed] ?? BANNER_SPEED_STAGES_PER_MIN.normal;
  return (stageWidth * stages) / 60;
}

/**
 * Seconds one loop of the marquee takes: the distance the track ACTUALLY
 * travels per loop (`loopWidth` px — half the track, i.e. every copy that
 * tiles the bar once) at the speed above, in 0.1 s steps, never below the
 * minimum.
 *
 * 2026-11-23 fix: the bar used to time a loop by ONE copy's width while the
 * track slid half its copies, so a message short enough to need 2 or 3 copies
 * to fill the bar moved 2x or 3x the chosen speed (measured on the shipped
 * component at "slow" on a 1920 stage: 96 px/s for a long message, 192 px/s
 * for a ~60-character one, 290 px/s for a ~25-character one). Timing the
 * distance travelled makes the speed the same for every message length.
 */
export function bannerLoopSeconds(loopWidth: number, stageWidth: number, speed: BannerSpeed): number {
  const pxPerSecond = bannerPxPerSecond(stageWidth, speed);
  if (!(pxPerSecond > 0) || !(loopWidth > 0)) return BANNER_MIN_LOOP_SECONDS;
  return Math.max(BANNER_MIN_LOOP_SECONDS, Math.round((loopWidth / pxPerSecond) * 10) / 10);
}

export const BANNER_SIZES = ['small', 'medium', 'large'] as const;
export type BannerSize = (typeof BANNER_SIZES)[number];

/**
 * Banner text size as a fraction of the stage width, with px clamps.
 * `base` is the size the text starts at (static and scrolling); `floor` is the
 * smallest a long static message may shrink to while fitting 2 lines. MEDIUM
 * is the size every banner with options has drawn since 2026-11-01 (0.022 /
 * 0.0115, 20-120 / 14-60 px) — unchanged. Small and large scale it by
 * 0.017/0.022 and 0.030/0.022, clamps included (small's lower clamps are held
 * at 16 / 12 px so a small canvas stays legible).
 */
export interface BannerTextScale {
  base: number;
  min: number;
  max: number;
  floor: number;
  floorMin: number;
  floorMax: number;
}
export const BANNER_TEXT_SCALE: Record<BannerSize, BannerTextScale> = {
  small: { base: 0.017, min: 16, max: 92, floor: 0.0089, floorMin: 12, floorMax: 46 },
  medium: { base: 0.022, min: 20, max: 120, floor: 0.0115, floorMin: 14, floorMax: 60 },
  large: { base: 0.03, min: 27, max: 164, floor: 0.0157, floorMin: 19, floorMax: 82 },
};

/** The banner's starting font size and static shrink floor, in CSS px, for a stage `stageWidth` px wide. */
export function bannerFontPx(size: BannerSize | undefined, stageWidth: number): { base: number; floor: number } {
  const s = BANNER_TEXT_SCALE[size === 'small' || size === 'large' ? size : 'medium'];
  const w = stageWidth > 0 && Number.isFinite(stageWidth) ? stageWidth : 1920;
  return {
    base: Math.max(s.min, Math.min(s.max, Math.round(w * s.base))),
    floor: Math.max(s.floorMin, Math.min(s.floorMax, Math.round(w * s.floor))),
  };
}

/** Curated colours offered next to the brand presets. Hex, so they travel. */
export const BANNER_PRESET_COLORS = [
  { id: 'blue', hex: '#1d4ed8' },
  { id: 'green', hex: '#15803d' },
  { id: 'amber', hex: '#f59e0b' },
  { id: 'red', hex: '#b91c1c' },
  { id: 'purple', hex: '#6d28d9' },
  { id: 'dark', hex: '#0f172a' },
] as const;

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` / `ABCDEF` / ` #AbCdEf ` → `#aabbcc`; anything else → null. */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const m = HEX_RE.exec(input.trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h}`;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a hex colour. */
export function relativeLuminance(hex: string): number {
  const n = normalizeHex(hex) ?? '#000000';
  const r = parseInt(n.slice(1, 3), 16);
  const g = parseInt(n.slice(3, 5), 16);
  const b = parseInt(n.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio (1-21) between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const BANNER_TEXT_LIGHT = '#ffffff';
export const BANNER_TEXT_DARK = '#0f172a';
export const WCAG_AA = 4.5;

export interface BannerTextChoice {
  text: string;
  ratio: number;
  /** false: neither white nor dark slate reaches WCAG AA on this background. */
  passesAA: boolean;
}

/** The better of white / dark slate on `bg`, with its ratio and AA verdict. */
export function readableTextOn(bg: string): BannerTextChoice {
  const light = contrastRatio(bg, BANNER_TEXT_LIGHT);
  const dark = contrastRatio(bg, BANNER_TEXT_DARK);
  const useLight = light >= dark;
  const ratio = useLight ? light : dark;
  return { text: useLight ? BANNER_TEXT_LIGHT : BANNER_TEXT_DARK, ratio, passesAA: ratio >= WCAG_AA };
}

export interface BannerOptions {
  /** Normalised `#rrggbb`, or absent for the severity's own colour. */
  color?: string;
  mode: BannerMode;
  speed: BannerSpeed;
  /** Text size; ABSENT = medium (the canonical form never carries 'medium'). */
  size?: Exclude<BannerSize, 'medium'>;
}

/** The text size an option set asks for (absent / unknown = medium). */
export function bannerSizeOf(options: { size?: unknown } | null | undefined): BannerSize {
  const size = options?.size;
  return size === 'small' || size === 'large' ? size : 'medium';
}

/**
 * Collapse anything (a request body, a DB Json value, a signed payload) to a
 * canonical option set, or null when it asks for nothing the default look
 * does not already do. Key order is fixed (color, mode, speed, size) so
 * identical options hash alike; `size` appears only for small / large.
 *
 * What counts as a request: a valid colour, an explicit mode, or (2026-11-23)
 * an explicit size — any of the three, medium included, because every named
 * size is drawn on the stage-relative scale and "today's look" (null, the
 * fixed 20 px text of a message with no options) is none of them; answering
 * `{ size: 'medium' }` with null would draw text smaller than "small". A speed
 * alone still asks for nothing (it means nothing without scrolling), and an
 * unknown size alone is nothing recognisable: both stay null.
 */
export function sanitizeBannerOptions(raw: unknown): BannerOptions | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const color = normalizeHex(r.color);
  const explicitMode = r.mode === 'scroll' || r.mode === 'static';
  const explicitSize = r.size === 'small' || r.size === 'medium' || r.size === 'large';
  const mode: BannerMode = r.mode === 'scroll' ? 'scroll' : 'static';
  const speed: BannerSpeed = r.speed === 'slow' || r.speed === 'fast' ? r.speed : 'normal';
  const size = bannerSizeOf(r);
  // Nothing recognisable asked for: today's look.
  if (!color && !explicitMode && !explicitSize) return null;
  return { ...(color ? { color } : {}), mode, speed, ...(size !== 'medium' ? { size } : {}) };
}

/** Request-body shape (strict: unknown keys are refused; values sanitised later). */
export const BannerStyleInputSchema = z
  .object({
    color: z.string().trim().regex(HEX_RE, 'color must be a hex value like #1d4ed8').optional(),
    mode: z.enum(BANNER_MODES).optional(),
    speed: z.enum(BANNER_SPEEDS).optional(),
    size: z.enum(BANNER_SIZES).optional(),
  })
  .strict();
export type BannerStyleInput = z.infer<typeof BannerStyleInputSchema>;
