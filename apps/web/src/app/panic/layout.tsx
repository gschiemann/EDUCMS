import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'EMERGENCY TRG',
  description: 'Emergency facility broadcast override',
  manifest: '/manifest-panic.json',
  appleWebApp: {
    capable: true,
    title: 'EMERGENCY',
    statusBarStyle: 'black-translucent',
  },
};

// LIFE-SAFETY (2026-05-23 launch audit P0 #2): the panic page MUST lock
// zoom. The 3-second hold-to-trigger gesture is broken by an accidental
// iOS pinch-zoom mid-press — pointer events cancel and the trigger fails
// silently. Root layout sets userScalable=true so this route-level
// override is required to honor the original CLAUDE.md guarantee that
// "/player and /panic routes lock zoom in their own layouts."
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function PanicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
