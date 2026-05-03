'use client';

/**
 * RetailWayfindingMapWidget — simple SVG store map with department callouts.
 *
 * Lobby/entrance helper: "where in the store is the thing you came
 * for?" Renders a flat top-down store layout with named department
 * blocks, each in a distinct color, plus a "you are here" pin and
 * an optional currently-highlighted department that pulses.
 *
 * Departments accept percentage coordinates (0-100) so the same widget
 * works at any aspect ratio. We compose the SVG ourselves rather than
 * accepting an upload — operator-uploaded floor plans land in a Sprint
 * 8b feature; this is the v1 "good enough" so a kiosk can ship today.
 *
 * Editorial palette: warm parchment background, ink lines, muted accent
 * blocks. Reads as "department-store directory" rather than "Google
 * Maps" or "QSR menu".
 */

export interface RetailDepartment {
  /** Department display name e.g. "Womens", "Mens", "Footwear". */
  name: string;
  /** Top-left X position as percentage of viewBox (0-100). */
  x: number;
  /** Top-left Y position as percentage of viewBox (0-100). */
  y: number;
  /** Width as percentage. */
  width: number;
  /** Height as percentage. */
  height: number;
  /** Tile fill color. Defaults to a neutral parchment tone. */
  color?: string;
  /** Optional emoji rendered inside the tile. */
  emoji?: string;
  /** Mark this tile as the "current highlight" — pulses + draws an arrow. */
  highlight?: boolean;
}

export interface RetailWayfindingMapConfig {
  departments?: RetailDepartment[];
  /** Section heading rendered above the map. */
  heading?: string;
  /** Subhead under heading. */
  subheading?: string;
  /** "You are here" marker position as percentages. Set to null to hide. */
  youAreHere?: { x: number; y: number } | null;
  /** Background color. */
  bgColor?: string;
  /** Ink color for outlines + labels. */
  inkColor?: string;
  /** Accent for the highlighted department + pin. */
  accentColor?: string;
}

const DEMO_DEPARTMENTS: RetailDepartment[] = [
  { name: 'Womens',     x: 6,  y: 12, width: 38, height: 30, color: '#e8dcc8', emoji: '👗' },
  { name: 'Mens',       x: 56, y: 12, width: 38, height: 30, color: '#cfd8dc', emoji: '👔' },
  { name: 'Footwear',   x: 6,  y: 50, width: 26, height: 28, color: '#d7c4a3', emoji: '👟' },
  { name: 'Accessories', x: 38, y: 50, width: 24, height: 28, color: '#c9b6a0', emoji: '👜', highlight: true },
  { name: 'Beauty',     x: 68, y: 50, width: 26, height: 28, color: '#f0d6d6', emoji: '💄' },
  { name: 'Checkout',   x: 38, y: 84, width: 24, height: 12, color: '#1a1411', emoji: '🛍' },
];

export function RetailWayfindingMapWidget({
  config,
}: {
  config?: RetailWayfindingMapConfig;
  live?: boolean;
}) {
  const c: RetailWayfindingMapConfig = config || {};
  const departments = c.departments && c.departments.length > 0 ? c.departments : DEMO_DEPARTMENTS;
  const heading = c.heading ?? 'Store Directory';
  const subheading = c.subheading ?? 'Find your aisle';
  const youAreHere = c.youAreHere === null ? null : (c.youAreHere ?? { x: 50, y: 92 });
  const bg = c.bgColor ?? '#faf6f1';
  const ink = c.inkColor ?? '#1a1411';
  const accent = c.accentColor ?? '#9a2d2d';

  return (
    <div
      className="rwmw-root"
      style={
        {
          '--rwmw-bg': bg,
          '--rwmw-ink': ink,
          '--rwmw-accent': accent,
        } as React.CSSProperties
      }
    >
      <style>{CSS}</style>

      <header className="rwmw-header">
        <h2 className="rwmw-heading">{heading}</h2>
        <div className="rwmw-subheading">{subheading}</div>
      </header>

      <div className="rwmw-map-wrap">
        <svg
          className="rwmw-map"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-label="Store wayfinding map"
        >
          {/* Outer store wall */}
          <rect
            x="2" y="2" width="96" height="96"
            fill="none"
            stroke={ink}
            strokeWidth="0.4"
            opacity="0.4"
          />
          {/* Department tiles */}
          {departments.map((d, i) => (
            <g key={i}>
              <rect
                x={d.x}
                y={d.y}
                width={d.width}
                height={d.height}
                fill={d.color || '#e8e2d7'}
                stroke={ink}
                strokeWidth="0.25"
                opacity={d.highlight ? 1 : 0.85}
                className={d.highlight ? 'rwmw-tile-pulse' : ''}
              />
              {d.highlight && (
                <rect
                  x={d.x}
                  y={d.y}
                  width={d.width}
                  height={d.height}
                  fill="none"
                  stroke={accent}
                  strokeWidth="0.6"
                  className="rwmw-tile-highlight-ring"
                />
              )}
            </g>
          ))}
        </svg>

        {/* Department labels positioned absolutely so they pick up real
            font sizing rather than viewBox-scaled SVG text (which clamps
            terribly across resolutions). */}
        <div className="rwmw-labels">
          {departments.map((d, i) => (
            <div
              className={`rwmw-label ${d.highlight ? 'rwmw-label-active' : ''}`}
              key={i}
              style={{
                left: `${d.x + d.width / 2}%`,
                top: `${d.y + d.height / 2}%`,
              }}
            >
              {d.emoji && <span className="rwmw-label-emoji">{d.emoji}</span>}
              <span className="rwmw-label-name">{d.name}</span>
            </div>
          ))}

          {youAreHere && (
            <div
              className="rwmw-here"
              style={{ left: `${youAreHere.x}%`, top: `${youAreHere.y}%` }}
            >
              <div className="rwmw-here-pin" />
              <div className="rwmw-here-label">YOU ARE HERE</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Inter:wght@500;600;700&display=swap');

.rwmw-root {
  position: absolute; inset: 0;
  background: var(--rwmw-bg, #faf6f1);
  color: var(--rwmw-ink, #1a1411);
  font-family: 'Inter', sans-serif;
  padding: clamp(16px, 3cqh, 40px) clamp(20px, 4cqw, 56px);
  display: flex; flex-direction: column;
  container-type: size;
  overflow: hidden;
}
.rwmw-header {
  text-align: center;
  margin-bottom: clamp(8px, 2cqh, 20px);
  flex: none;
}
.rwmw-heading {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: clamp(22px, 5cqh, 56px);
  letter-spacing: -0.01em;
  margin: 0;
}
.rwmw-subheading {
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: clamp(10px, 1.5cqh, 14px);
  letter-spacing: 0.4em;
  text-transform: uppercase;
  opacity: 0.55;
  margin-top: 4px;
}
.rwmw-map-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
}
.rwmw-map {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  display: block;
}
.rwmw-labels {
  position: absolute; inset: 0;
  pointer-events: none;
}
.rwmw-label {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex; flex-direction: column;
  align-items: center;
  gap: 2px;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  color: var(--rwmw-ink, #1a1411);
  text-align: center;
}
.rwmw-label-emoji {
  font-size: clamp(20px, 4.5cqh, 64px);
  line-height: 1;
}
.rwmw-label-name {
  font-size: clamp(10px, 1.7cqh, 18px);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.rwmw-label-active .rwmw-label-name {
  color: var(--rwmw-accent);
  font-weight: 700;
}
.rwmw-tile-pulse {
  animation: rwmw-pulse 2s ease-in-out infinite;
  transform-origin: center;
}
.rwmw-tile-highlight-ring {
  animation: rwmw-ring 2s ease-in-out infinite;
}
@keyframes rwmw-pulse {
  0%, 100% { opacity: 0.92; }
  50%      { opacity: 1; }
}
@keyframes rwmw-ring {
  0%, 100% { stroke-width: 0.6; }
  50%      { stroke-width: 1.2; }
}
.rwmw-here {
  position: absolute;
  transform: translate(-50%, -100%);
  display: flex; flex-direction: column;
  align-items: center;
  gap: 2px;
}
.rwmw-here-pin {
  width: clamp(14px, 2cqh, 22px);
  height: clamp(14px, 2cqh, 22px);
  background: var(--rwmw-accent);
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25), 0 0 0 4px rgba(154,45,45,0.2);
  animation: rwmw-pin-pulse 1.6s ease-in-out infinite;
}
@keyframes rwmw-pin-pulse {
  0%, 100% { box-shadow: 0 4px 12px rgba(0,0,0,0.25), 0 0 0 4px rgba(154,45,45,0.2); }
  50%      { box-shadow: 0 4px 12px rgba(0,0,0,0.25), 0 0 0 10px rgba(154,45,45,0.05); }
}
.rwmw-here-label {
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: clamp(8px, 1.2cqh, 11px);
  letter-spacing: 0.3em;
  color: var(--rwmw-accent);
  margin-top: 2px;
  white-space: nowrap;
}
`;
