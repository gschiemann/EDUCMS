/**
 * Jest stand-in for `lucide-react/dynamic` (Wave B / editor-crush B5,
 * 2026-07-02).
 *
 * The real module is ESM-only (`dynamic.js` is a bare `export * from
 * './dynamic.mjs'` shim — lucide can't ship an exports map without breaking
 * other runtimes, see lucide-icons/lucide#2743), which jest's CJS runtime
 * can't parse and transforming the 1,500-lazy-import `dynamic.mjs` would be
 * slow for every suite. IconWidget + PropertiesPanel import it, and
 * variants-register transitively pulls both into most template-builder
 * suites — so jest.config.js maps the module here.
 *
 * Mirrors the real surface: `DynamicIcon` (renders an inert svg carrying
 * data-lucide-name so tests can assert the picked icon), `iconNames` (a
 * representative subset including every name our defaults/tests rely on),
 * and the `IconName` type (relaxed to string for the mock).
 */
import type { ReactElement, SVGProps } from 'react';

export type IconName = string;

export const iconNames: IconName[] = [
  'star',
  'heart',
  'trophy',
  'pizza',
  'graduation-cap',
  'bell',
  'calendar',
  'clock',
  'sun',
  'cloud',
  'arrow-right',
  'check',
  'x',
  'music',
  'camera',
];

export function DynamicIcon({
  name,
  fallback,
  ...rest
}: SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: string | number;
  strokeWidth?: string | number;
  absoluteStrokeWidth?: boolean;
  fallback?: () => ReactElement | null;
}) {
  if (!iconNames.includes(name)) return fallback ? fallback() : null;
  return <svg data-lucide-name={name} aria-hidden {...rest} />;
}
