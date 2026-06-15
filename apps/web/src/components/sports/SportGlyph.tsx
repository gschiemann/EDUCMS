/**
 * Vector sport / possession / serve marks for the crowd surfaces.
 *
 * The 2026-06-15 sports-pro gap analysis flagged emoji-as-iconography (def.emoji
 * sport marks, 🏈 possession, 🏓 serve) as the #1 consumer-grade "tell" at 8-foot
 * distance and on a livestream — emoji render platform-dependently. These are
 * drawn, theme-tintable inline SVGs (stroke/fill = currentColor) so a surface can
 * tint them with the team/brand color.
 *
 * STRICTLY AN UPGRADE: <SportGlyph> for a sport we don't have a vector for falls
 * back to the supplied emoji, so no surface ever looks worse than today — only
 * better where a clean vector exists. Taurus / Chromium-83 safe (plain SVG).
 */
import * as React from 'react';

type Common = { size?: number; color?: string; title?: string; style?: React.CSSProperties };

const svg = (size: number, color: string, title: string | undefined, children: React.ReactNode) => (
  <svg
    width={size} height={size} viewBox="0 0 48 48" fill="none"
    stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
    role="img" aria-label={title} style={{ display: 'block', overflow: 'visible' }}
  >
    {title ? <title>{title}</title> : null}
    {children}
  </svg>
);

/** Curated, recognizable line-glyphs. Keys are SportDefinition.key values. */
const SPORT_GLYPHS: Record<string, (s: number, c: string, t?: string) => React.ReactNode> = {
  basketball: (s, c, t) => svg(s, c, t ?? 'Basketball', <>
    <circle cx="24" cy="24" r="18" /><path d="M6 24h36M24 6v36" />
    <path d="M11 11c8 6 8 20 0 26M37 11c-8 6-8 20 0 26" /></>),
  soccer: (s, c, t) => svg(s, c, t ?? 'Soccer', <>
    <circle cx="24" cy="24" r="18" /><path d="M24 14l7 5-3 9h-8l-3-9z" fill={c} stroke="none" />
    <path d="M24 6v8M9 19l7 5M39 19l-7 5M16 38l3-9M32 38l-3-9" /></>),
  volleyball: (s, c, t) => svg(s, c, t ?? 'Volleyball', <>
    <circle cx="24" cy="24" r="18" /><path d="M24 6c-6 9-6 27 0 36M9 14c9 5 21 5 30 0M9 34c9-5 21-5 30 0" /></>),
  baseball: (s, c, t) => svg(s, c, t ?? 'Baseball', <>
    <circle cx="24" cy="24" r="18" /><path d="M13 11c4 7 4 19 0 26M35 11c-4 7-4 19 0 26" /></>),
  softball: (s, c, t) => SPORT_GLYPHS.baseball(s, c, t ?? 'Softball'),
  football: (s, c, t) => svg(s, c, t ?? 'Football', <>
    <path d="M8 24c0-8 7-14 16-14s16 6 16 14-7 14-16 14S8 32 8 24z" />
    <path d="M20 24h8M24 20v8M14 17l3 3M34 17l-3 3M14 31l3-3M34 31l-3-3" /></>),
  hockey: (s, c, t) => svg(s, c, t ?? 'Hockey', <>
    <ellipse cx="24" cy="28" rx="15" ry="6" /><path d="M9 28v-4M39 28v-4M9 24a15 6 0 0 1 30 0" /></>),
  lacrosse: (s, c, t) => svg(s, c, t ?? 'Lacrosse', <>
    <circle cx="16" cy="16" r="7" /><path d="M21 21l18 18M13 13c-2 0-5 1-5 5" /></>),
  water_polo: (s, c, t) => svg(s, c, t ?? 'Water polo', <>
    <circle cx="24" cy="24" r="18" /><path d="M7 20c5 4 11 4 17 0s12-4 17 0M7 30c5 4 11 4 17 0s12-4 17 0" /></>),
  tennis: (s, c, t) => svg(s, c, t ?? 'Tennis', <>
    <circle cx="24" cy="24" r="18" /><path d="M12 9c8 6 8 24 0 30M36 9c-8 6-8 24 0 30" /></>),
  pickleball: (s, c, t) => svg(s, c, t ?? 'Pickleball', <>
    <circle cx="24" cy="24" r="18" /><circle cx="18" cy="18" r="2" fill={c} stroke="none" />
    <circle cx="30" cy="20" r="2" fill={c} stroke="none" /><circle cx="22" cy="30" r="2" fill={c} stroke="none" />
    <circle cx="32" cy="30" r="2" fill={c} stroke="none" /></>),
  wrestling: (s, c, t) => svg(s, c, t ?? 'Wrestling', <>
    <circle cx="24" cy="12" r="5" /><path d="M14 40c0-8 4-14 10-14s10 6 10 14M16 28l-6-4M32 28l6-4" /></>),
};

/** A clean generic mark for sports without a bespoke glyph (a stadium/board abstract). */
function GenericMark({ size = 48, color = 'currentColor', title }: Common) {
  return svg(size, color, title ?? 'Sport', <>
    <rect x="7" y="11" width="34" height="22" rx="3" /><path d="M14 33v4h20v-4M24 17v10M17 22h14" /></>);
}

/** The big sport mark (pre-game / leaderboard header). Falls back to the emoji
 *  when we have no vector for that sport. */
export function SportMark({ sport, fallbackEmoji, size = 48, color = 'currentColor', title, style }: Common & {
  sport: string | null | undefined; fallbackEmoji?: string;
}) {
  const draw = sport ? SPORT_GLYPHS[sport] : undefined;
  if (draw) return <span style={style}>{draw(size, color, title)}</span>;
  if (fallbackEmoji) return <span style={{ fontSize: size, lineHeight: 1, ...style }} aria-label={title}>{fallbackEmoji}</span>;
  return <span style={style}><GenericMark size={size} color={color} title={title} /></span>;
}

/** Possession indicator — a bold chevron pointing toward the team with the ball.
 *  Replaces the 🏈 possession emoji. `dir`: 'home' points right, 'away' points left. */
export function PossessionGlyph({ dir, size = 40, color = 'currentColor', title, style }: Common & {
  dir: 'home' | 'away';
}) {
  const points = dir === 'home' ? '16,10 34,24 16,38' : '32,10 14,24 32,38';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={title ?? 'Possession'} style={{ display: 'block', ...style }}>
      {title ? <title>{title}</title> : null}
      <polygon points={points} fill={color} />
    </svg>
  );
}

/** Serve indicator — a filled ball dot with a highlight. Replaces 🏐/🏓 serve emoji. */
export function ServeGlyph({ size = 28, color = 'currentColor', title, style }: Common) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={title ?? 'Serving'} style={{ display: 'block', ...style }}>
      {title ? <title>{title}</title> : null}
      <circle cx="24" cy="24" r="16" fill={color} />
      <circle cx="18" cy="18" r="5" fill="rgba(255,255,255,0.55)" />
    </svg>
  );
}
