/**
 * Pure brand-contrast math — ZERO imports on purpose so the CI gate
 * (apps/web/tools/check-brand-contrast.cjs) can transpile and execute this
 * file directly. Consumed by lib/branding.ts cssVarsFromPalette to derive
 * the contrast-guaranteed workhorse shades (see the contract comment there —
 * 2026-07-22 VisionCore cream incident).
 */

function hexToRgbTuple(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}

function lum(hex: string): number {
  const ch = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const [r, g, b] = hexToRgbTuple(hex);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG contrast ratio between two hex colors (symmetric). */
export function contrastRatio(a: string, b: string): number {
  const la = lum(a); const lb = lum(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r0, g0, b0] = hexToRgbTuple(hex).map((v) => v / 255);
  const max = Math.max(r0, g0, b0); const min = Math.min(r0, g0, b0);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r0) h = ((g0 - b0) / d + (g0 < b0 ? 6 : 0));
  else if (max === g0) h = (b0 - r0) / d + 2;
  else h = (r0 - g0) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }: { h: number; s: number; l: number }): string {
  const sN = s / 100; const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/**
 * Darken `hex` along its own hue until it contrasts ≥ `target` vs white.
 * Already-passing colors return UNCHANGED (a healthy dark brand never
 * shifts). Never returns pure black — the binary search keeps the closest
 * passing lightness, so a cream becomes a deep gold, not #000.
 */
export function ensureReadableOnWhite(hexIn: string, target: number): string {
  if (!/^#[0-9a-fA-F]{3,8}$/.test(hexIn)) return hexIn;
  const WHITE = '#ffffff';
  if (contrastRatio(hexIn, WHITE) >= target) return hexIn;
  const { h, s, l } = hexToHsl(hexIn);
  let lo = 0; let hi = l; let best = hslToHex({ h, s, l: 0 });
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const cand = hslToHex({ h, s, l: mid });
    if (contrastRatio(cand, WHITE) >= target) { best = cand; lo = mid; } else { hi = mid; }
  }
  return best;
}
