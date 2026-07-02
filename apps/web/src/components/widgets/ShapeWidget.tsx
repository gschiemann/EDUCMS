"use client";

/**
 * ShapeWidget — Wave B / editor-crush B2 (2026-07-02).
 *
 * Audit finding (05-EDITOR-CRUSH-LENSES.md elements-assets P1): no static
 * SHAPE widget exists — rect / circle / line / arrow / divider don't exist
 * as design elements. Canva's Elements tray ships these as first-class
 * draggables with fill, border color/weight/style, corner radius, and
 * opacity — the building blocks of nearly every Canva design.
 *
 * ONE widget type (`SHAPE`) with a `shape` config key selecting the
 * primitive — NOT six separate widget types (per the build spec). Renders
 * as plain inline SVG, so it's Taurus-Chromium-83-safe by construction: no
 * CSS `inset`/`gap` shorthand, no backdrop-filter, no flex-gap. The SVG
 * fills its zone via `width="100%" height="100%"` + `preserveAspectRatio`
 * (none for rect/pill/circle so they can be resized non-uniformly like a
 * real design element; arrows/lines keep their stroke a fixed fraction of
 * the shorter side so a very short/tall zone doesn't warp the arrowhead).
 *
 * Config:
 *   shape: 'rectangle' | 'pill' | 'circle' | 'line' | 'arrow' | 'triangle' | 'star'
 *   fill: string        — CSS color OR a brand-preset var() (ColorField already
 *                          resolves "Brand primary"/"Brand accent" to
 *                          var(--brand-primary)/var(--brand-accent))
 *   fillOpacity: number  — 0–1, independent of the whole-widget `opacity`
 *   borderColor: string  — stroke color, '' = no border
 *   borderWidth: number  — stroke width in px (at the shape's natural scale)
 *   radius: number        — corner radius for 'rectangle' (px, at natural scale)
 *   opacity: number       — whole-shape opacity, 0–1
 */

export type ShapeKind = 'rectangle' | 'pill' | 'circle' | 'line' | 'arrow' | 'triangle' | 'star';

export interface ShapeConfig {
  shape?: ShapeKind;
  fill?: string;
  fillOpacity?: number;
  borderColor?: string;
  borderWidth?: number;
  radius?: number;
  opacity?: number;
}

export const SHAPE_KINDS: Array<{ key: ShapeKind; label: string; hint: string }> = [
  { key: 'rectangle', label: 'Rectangle',     hint: 'Filled rectangle with optional corner radius + border.' },
  { key: 'pill',      label: 'Rounded Pill',  hint: 'Fully rounded rectangle — badge / chip / banner shape.' },
  { key: 'circle',    label: 'Circle',        hint: 'Filled circle / ellipse — scales to the zone.' },
  { key: 'triangle',  label: 'Triangle',      hint: 'Filled triangle — accent shape or callout pointer.' },
  { key: 'star',      label: 'Star',          hint: 'Five-point star — badge / rating / spirit accent.' },
  { key: 'line',      label: 'Divider Line',  hint: 'A single horizontal line — section divider.' },
  { key: 'arrow',     label: 'Arrow',         hint: 'A horizontal arrow — directional accent.' },
];

const DEFAULT_FILL = 'var(--brand-primary, #6366f1)';

export function ShapeWidget({ config }: { config: ShapeConfig }) {
  const shape = config.shape || 'rectangle';
  const fill = config.fill || DEFAULT_FILL;
  const fillOpacity = clamp01(config.fillOpacity ?? 1);
  const borderColor = config.borderColor || '';
  const borderWidth = Math.max(0, config.borderWidth ?? 0);
  const radius = Math.max(0, config.radius ?? 12);
  const opacity = clamp01(config.opacity ?? 1);
  const hasBorder = !!borderColor && borderWidth > 0;

  // A 200x200 unit box for shapes that fill in both dimensions (rect/pill/
  // circle/triangle/star) so radius/borderWidth read as intuitive px values
  // at typical zone sizes; a wide 200x40 box for line/arrow so the stroke
  // stays a sane fraction of height instead of stretching into a blob.
  const isWide = shape === 'line' || shape === 'arrow';
  const viewBox = isWide ? '0 0 200 40' : '0 0 200 200';
  const strokeProps = hasBorder ? { stroke: borderColor, strokeWidth: borderWidth } : {};

  return (
    <div
      className="w-full h-full flex items-center justify-center pointer-events-none select-none"
      style={{ opacity }}
      aria-hidden
    >
      <svg
        viewBox={viewBox}
        // preserveAspectRatio="none" lets rect/pill/circle stretch to fill a
        // non-square zone (a design shape should follow the box the operator
        // dragged, exactly like Canva) — arrows/lines already default to
        // 'none' via their own viewBox aspect, kept explicit for clarity.
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ display: 'block' }}
      >
        {shape === 'rectangle' && (
          <rect
            x={borderWidth / 2} y={borderWidth / 2}
            width={200 - borderWidth} height={200 - borderWidth}
            rx={radius} ry={radius}
            fill={fill} fillOpacity={fillOpacity}
            {...strokeProps}
          />
        )}
        {shape === 'pill' && (
          <rect
            x={borderWidth / 2} y={borderWidth / 2}
            width={200 - borderWidth} height={200 - borderWidth}
            rx={100} ry={100}
            fill={fill} fillOpacity={fillOpacity}
            {...strokeProps}
          />
        )}
        {shape === 'circle' && (
          <ellipse
            cx={100} cy={100} rx={100 - borderWidth / 2} ry={100 - borderWidth / 2}
            fill={fill} fillOpacity={fillOpacity}
            {...strokeProps}
          />
        )}
        {shape === 'triangle' && (
          <polygon
            points="100,4 196,196 4,196"
            fill={fill} fillOpacity={fillOpacity}
            strokeLinejoin="round"
            {...strokeProps}
          />
        )}
        {shape === 'star' && (
          <polygon
            points={starPoints(100, 100, 96, 38, 5)}
            fill={fill} fillOpacity={fillOpacity}
            strokeLinejoin="round"
            {...strokeProps}
          />
        )}
        {shape === 'line' && (
          <line
            x1={4} y1={20} x2={196} y2={20}
            stroke={fill} strokeOpacity={fillOpacity}
            strokeWidth={Math.max(2, borderWidth || 4)}
            strokeLinecap="round"
          />
        )}
        {shape === 'arrow' && (
          <g fill="none">
            <line
              x1={4} y1={20} x2={168} y2={20}
              stroke={fill} strokeOpacity={fillOpacity}
              strokeWidth={Math.max(2, borderWidth || 4)}
              strokeLinecap="round"
            />
            <polygon
              points="160,4 196,20 160,36"
              fill={fill} fillOpacity={fillOpacity}
            />
          </g>
        )}
      </svg>
    </div>
  );
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Five-point star polygon points, centered at (cx, cy). */
function starPoints(cx: number, cy: number, outerR: number, innerR: number, points: number): string {
  const step = Math.PI / points;
  const coords: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = i * step - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    coords.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return coords.join(' ');
}
