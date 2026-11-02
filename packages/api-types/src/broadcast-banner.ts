/**
 * Broadcast banner options (2026-11-01) — the sender's choice of colour and
 * motion for an INFO / WARN text broadcast, shared by the API (validation,
 * storage, delivery), the composer preview and the player so all three agree
 * byte for byte.
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
 * PURE — no DOM, no Node.
 */
import { z } from 'zod';

export const BANNER_MODES = ['static', 'scroll'] as const;
export type BannerMode = (typeof BANNER_MODES)[number];
export const BANNER_SPEEDS = ['slow', 'normal', 'fast'] as const;
export type BannerSpeed = (typeof BANNER_SPEEDS)[number];

/** Marquee speed in canvas-relative terms: stage widths crossed per minute. */
export const BANNER_SPEED_STAGES_PER_MIN: Record<BannerSpeed, number> = {
  slow: 3,
  normal: 5,
  fast: 8,
};

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
}

/**
 * Collapse anything (a request body, a DB Json value, a signed payload) to a
 * canonical option set, or null when it asks for nothing the default look
 * does not already do. Key order is fixed so identical options hash alike.
 */
export function sanitizeBannerOptions(raw: unknown): BannerOptions | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const color = normalizeHex(r.color);
  const explicitMode = r.mode === 'scroll' || r.mode === 'static';
  const mode: BannerMode = r.mode === 'scroll' ? 'scroll' : 'static';
  const speed: BannerSpeed = r.speed === 'slow' || r.speed === 'fast' ? r.speed : 'normal';
  // Nothing recognisable asked for: today's look.
  if (!color && !explicitMode) return null;
  return { ...(color ? { color } : {}), mode, speed };
}

/** Request-body shape (strict: unknown keys are refused; values sanitised later). */
export const BannerStyleInputSchema = z
  .object({
    color: z.string().trim().regex(HEX_RE, 'color must be a hex value like #1d4ed8').optional(),
    mode: z.enum(BANNER_MODES).optional(),
    speed: z.enum(BANNER_SPEEDS).optional(),
  })
  .strict();
export type BannerStyleInput = z.infer<typeof BannerStyleInputSchema>;
