import type { Metadata, Viewport } from 'next';
import { Inter, Fredoka, Caveat } from 'next/font/google';
import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import Providers from '@/components/providers';
import { LogViewer } from '@/components/debug/LogViewer';

// Development-only axe accessibility overlay — never shipped in production builds.
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  const ReactDOM = require('react-dom');
  const axeCore = require('@axe-core/react');
  axeCore.default(require('react'), ReactDOM, 1000);
}

const inter = Inter({ subsets: ['latin'] });

// Rounded, friendly display font — used by playful template themes (e.g. Sunny Meadow).
// Exposed as a CSS variable so widget components can opt-in per theme.
const fredoka = Fredoka({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-fredoka',
  display: 'swap',
});

// Handwritten script — used for "teacher signatures", polaroid labels, doodle-style accents.
const caveat = Caveat({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-caveat',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Digital Signage CMS',
  description: 'Centralized school signage management.',
  // 2026-05-14 — PWA wiring (Phase 1 of MOBILE_APP_ROADMAP.md). The
  // manifest opts the dashboard into Add-to-Home-Screen on iOS / Android,
  // applies the indigo theme color to the status bar, and surfaces a
  // home-screen shortcut to /panic for one-tap emergency triggers.
  // Note: the /player route has its OWN manifest at /player/manifest.json
  // (apps/web/src/app/player/layout.tsx); this one is for the operator
  // dashboard surface only.
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'EduCMS',
  },
};

// Next.js 14+ requires themeColor / viewport-meta options in a
// separate viewport export (the metadata export only carries SEO + OG
// fields now). 'black-translucent' Apple status-bar pairs with this
// indigo so the iOS notch / status bar reads as one continuous brand
// surface.
export const viewport: Viewport = {
  themeColor: '#6366f1',
  width: 'device-width',
  initialScale: 1,
  // Allow user-scale on the dashboard so an admin with vision needs
  // can pinch-zoom forms. The /player and /panic routes lock zoom in
  // their own layouts.
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${fredoka.variable} ${caveat.variable} min-h-screen bg-slate-50 text-slate-900 antialiased`} suppressHydrationWarning>
        <Providers>
          <TooltipProvider>
            {/* BrandStyleInjector moved to DashboardLayout — tenant
                branding MUST NOT leak onto the public marketing site
                ('/') or the /login page. Those pages belong to the
                vendor, not the customer, and must always render the
                default palette + wordmark. Only authed routes
                ([schoolId]/*, /onboarding/*, /settings/*) re-skin. */}
            <main className="w-full min-h-screen relative flex flex-col">
              <div className="absolute top-0 inset-x-0 h-96 bg-gradient-to-b from-indigo-50 to-transparent pointer-events-none -z-10" />
              {children}
            </main>
            {/* Toggle with Ctrl+Shift+L (Cmd+Shift+L on macOS). Zero
                footprint when closed — just a keydown listener. */}
            <LogViewer />
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
