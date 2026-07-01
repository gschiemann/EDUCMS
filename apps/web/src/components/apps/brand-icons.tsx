"use client";

/**
 * brand-icons — small local, inline-SVG brand marks for the App Library grid.
 *
 * World-class build (2026-07-01), discovery/mobile/a11y workstream: lucide-
 * react (the app's icon set) dropped brand/logo glyphs, so the registry was
 * mapping every branded app to a generic semantic icon — Instagram literally
 * rendered as a ThumbsUp. In a 2-col card grid the icon IS the primary
 * at-a-glance identifier; a wrong/generic mark makes the grid unscannable.
 *
 * Deliberately NOT a runtime dependency (no react-icons / simple-icons npm
 * package) — each mark below is a hand-authored, simplified inline <svg>
 * path sized to a 24x24 viewBox, using `currentColor` so it inherits
 * whatever text color the call site sets (matches how lucide icons behave,
 * so swapping between the two is a drop-in visual match). Kept in its own
 * file (not app-registry.ts) so the registry stays React-free / unit-
 * testable per that file's stated design goal.
 *
 * Resolved in AppLibraryPanel exactly like the existing lucide `ICONS` map —
 * apps without a brand mark here (Weather, QR, Clock, Countdown, Maps
 * fallback, etc.) keep their lucide semantic icon.
 */

import type { SVGProps } from 'react';

type BrandIconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: BrandIconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function YouTubeIcon(props: BrandIconProps) {
  return (
    <Base {...props}>
      <path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.51 3.5 12 3.5 12 3.5s-7.51 0-9.38.56A3.02 3.02 0 0 0 .5 6.2 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.8 3.02 3.02 0 0 0 2.12 2.14c1.87.56 9.38.56 9.38.56s7.51 0 9.38-.56a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.8 12Z" />
    </Base>
  );
}

export function VimeoIcon(props: BrandIconProps) {
  return (
    <Base {...props}>
      <path d="M23.98 6.86c-.1 2.18-1.62 5.16-4.55 8.95C16.4 20.02 13.72 22 11.49 22c-1.38 0-2.55-1.28-3.5-3.83l-1.92-7.02c-.71-2.55-1.47-3.83-2.29-3.83-.18 0-.8.38-1.86 1.12L.8 7.13c1.17-1.03 2.32-2.06 3.45-3.1C5.75 2.7 6.9 2.05 7.6 1.98c1.67-.16 2.7.98 3.08 3.44.42 2.65.71 4.3.86 4.96.48 2.16.99 3.24 1.55 3.24.44 0 1.09-.68 1.97-2.06.87-1.37 1.34-2.42 1.4-3.14.13-1.19-.34-1.78-1.4-1.78-.5 0-1.01.11-1.55.34C14.55 4.16 16.66 2 20.03 2.1c2.45.07 3.6 1.66 3.44 4.76Z" />
    </Base>
  );
}

export function TwitchIcon(props: BrandIconProps) {
  return (
    <Base {...props}>
      <path d="M4.1 1 1.4 3.7v16.6h5.7V23l3-2.7h4L20.6 14V1H4.1Zm14.9 12.3-3 3h-4l-2.7 2.7v-2.7H5.9V2.7h13.1v10.6Z" />
      <path d="M15.5 6.3h1.9v5.5h-1.9zM10.4 6.3h1.9v5.5h-1.9z" />
    </Base>
  );
}

export function GoogleSlidesIcon(props: BrandIconProps) {
  return (
    <Base {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" opacity={0.25} />
      <path d="M14 2v6h6" opacity={0.5} />
      <rect x="7.5" y="11" width="9" height="7" rx="0.5" fill="#fff" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.5 13.6h9M11 11v7" stroke="currentColor" strokeWidth="1.1" />
    </Base>
  );
}

export function GoogleSheetsIcon(props: BrandIconProps) {
  return (
    <Base {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" opacity={0.25} />
      <path d="M14 2v6h6" opacity={0.5} />
      <rect x="7.5" y="11" width="9" height="7" rx="0.5" fill="#fff" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.5 13.4h9M7.5 15.5h9M11 11v7M14.5 11v7" stroke="currentColor" strokeWidth="0.9" />
    </Base>
  );
}

export function GoogleMapsIcon(props: BrandIconProps) {
  return (
    <Base {...props}>
      <path d="M12 2C7.6 2 4 5.6 4 10c0 6 8 12 8 12s8-6 8-12c0-4.4-3.6-8-8-8Zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
    </Base>
  );
}

export function GoogleCalendarIcon(props: BrandIconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="4" width="18" height="17" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 9h18" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 2v4M16 2v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="7" y="12" width="4" height="4" />
    </Base>
  );
}

export function CanvaIcon(props: BrandIconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="10" opacity={0.15} />
      <path d="M16.2 8.6c-.5-.9-1.5-1.5-2.8-1.5-2.2 0-3.9 2-3.9 4.6 0 2.4 1.4 4 3.4 4 1 0 1.8-.4 2.4-1.1l.1 1c-.7.6-1.7 1-2.9 1-2.9 0-5-2.2-5-5.4C7.5 7.7 9.9 5.5 13 5.5c2 0 3.5.9 4.2 2.3l-1 .8Z" />
    </Base>
  );
}

export function FacebookIcon(props: BrandIconProps) {
  return (
    <Base {...props}>
      <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" />
    </Base>
  );
}

export function InstagramIcon(props: BrandIconProps) {
  return (
    <Base {...props}>
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.4" cy="6.6" r="1.15" />
    </Base>
  );
}

/** appId -> brand icon component. Resolved in AppLibraryPanel with the
 *  existing lucide `ICONS` map as fallback for every non-branded app. */
export const BRAND_ICONS: Record<string, (props: BrandIconProps) => React.JSX.Element> = {
  youtube: YouTubeIcon,
  vimeo: VimeoIcon,
  twitch: TwitchIcon,
  'google-slides': GoogleSlidesIcon,
  'google-sheets': GoogleSheetsIcon,
  'google-maps': GoogleMapsIcon,
  calendar: GoogleCalendarIcon,
  canva: CanvaIcon,
  'facebook-page': FacebookIcon,
  instagram: InstagramIcon,
};
