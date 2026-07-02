"use client";

/**
 * IconWidget — Wave B / editor-crush B5 (2026-07-02).
 *
 * Audit finding (05-EDITOR-CRUSH-LENSES.md elements-assets P1): no
 * operator-facing icon library — icons are "type an emoji into a text
 * field", which renders inconsistently across the player fleet (Android
 * WebView vs desktop) and can't take brand colors.
 *
 * Backed by lucide-react's dynamic entry point (`lucide-react/dynamic`) —
 * already a dependency, ~1500 names, no new dep. DynamicIcon lazy-loads
 * each icon's module on demand, so registering an ICON widget does NOT pull
 * the whole icon set into the player bundle.
 *
 * Rendering: SVG stroke, so it's crisp at LED scale and identical on
 * Chromium 83 (Taurus). The icon scales to fill its zone (width/height
 * 100% on the svg, aspect preserved by the 24x24 viewBox's default
 * xMidYMid meet). Color defaults to the tenant brand primary via the
 * CSS var the brand pipeline already injects; ColorField's "Brand
 * primary/accent" presets write the same var() references.
 *
 * Config:
 *   icon: string         — lucide icon name (kebab-case, e.g. 'star',
 *                           'graduation-cap'); invalid names render nothing
 *   color: string        — stroke color (CSS color or var(--brand-…))
 *   strokeWidth: number  — lucide stroke width, 0.5–4 (default 2)
 *   opacity: number      — 0–1
 */

import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic';

export interface IconConfig {
  icon?: string;
  color?: string;
  strokeWidth?: number;
  opacity?: number;
}

const DEFAULT_ICON: IconName = 'star';
const DEFAULT_COLOR = 'var(--brand-primary, #6366f1)';

// O(1) validity check — DynamicIcon with an unknown name would try (and
// fail) a dynamic import; gate it here so a hand-typed bad name renders
// the fallback star instead of an error boundary trip.
const VALID_ICON_NAMES: ReadonlySet<string> = new Set(iconNames as readonly string[]);

/** Exported for the PropertiesPanel icon picker (searchable list). */
export function searchIconNames(query: string, limit = 60): IconName[] {
  const q = query.trim().toLowerCase();
  const out: IconName[] = [];
  for (const name of iconNames) {
    if (!q || name.includes(q)) {
      out.push(name);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function isValidIconName(name: string | undefined): name is IconName {
  return !!name && VALID_ICON_NAMES.has(name);
}

export function IconWidget({ config }: { config: IconConfig }) {
  const name: IconName = isValidIconName(config.icon) ? config.icon : DEFAULT_ICON;
  const color = config.color || DEFAULT_COLOR;
  const strokeWidth = Math.max(0.5, Math.min(4, config.strokeWidth ?? 2));
  const opacity = Math.max(0, Math.min(1, config.opacity ?? 1));

  return (
    <div
      className="w-full h-full flex items-center justify-center pointer-events-none select-none"
      style={{ opacity }}
      aria-hidden
    >
      <DynamicIcon
        name={name}
        color={color}
        strokeWidth={strokeWidth}
        // Fill the zone; the 24x24 viewBox keeps the aspect (xMidYMid meet)
        // so a non-square zone letterboxes instead of warping the glyph.
        style={{ width: '100%', height: '100%' }}
        fallback={() => null}
      />
    </div>
  );
}
