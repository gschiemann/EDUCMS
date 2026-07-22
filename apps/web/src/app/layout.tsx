import type { Metadata, Viewport } from 'next';
import { Inter, Fredoka, Caveat } from 'next/font/google';
import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import Providers from '@/components/providers';
import { LogViewer } from '@/components/debug/LogViewer';
import { BugCaptureProviders } from '@/components/bug-reporter/BugCaptureProviders';
import { BugReporterButton } from '@/components/bug-reporter/BugReporterButton';

// Development-only axe accessibility overlay — never shipped in production builds.
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  const ReactDOM = require('react-dom');
  const axeCore = require('@axe-core/react');
  axeCore.default(require('react'), ReactDOM, 1000);
}

// `variable` exposed so the zh CJK font-stack rule in globals.css can keep
// the optimized Inter for Latin glyphs while swapping in PingFang/YaHei/Noto
// for Chinese (html[lang^="zh"] — set by I18nProvider on language switch).
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

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
  // 2026-05-14 — rebrand. "Venue OS" replaces "EduCMS" as the
  // user-facing product name. The product was always going to be
  // bigger than K-12 (restaurants / retail / healthcare / corporate
  // lobbies were all in the roadmap); "Venue OS" frames it as an
  // operating system for any venue's screens + safety surfaces
  // rather than a school-only signage tool.
  title: 'Venue OS',
  description: 'Operating system for venues — content, screens, and emergency response on every display.',
  // 2026-05-14 — PWA wiring (Phase 1 of MOBILE_APP_ROADMAP.md). The
  // manifest opts the dashboard into Add-to-Home-Screen on iOS / Android,
  // applies the indigo theme color to the status bar, and surfaces a
  // home-screen shortcut to /panic for one-tap emergency triggers.
  // Note: the /player route has its OWN manifest at /player/manifest.json
  // (apps/web/src/app/player/layout.tsx); this one is for the operator
  // dashboard surface only.
  manifest: '/manifest.webmanifest',
  // Explicit icon list — iOS Safari prioritizes `apple-touch-icon`
  // links for the home-screen badge over the manifest. Next.js
  // emits <link rel="apple-touch-icon"> for the matching `icons`
  // entry; we surface 180px (iPhone @3x default) + 167px (iPad Pro)
  // + 152px (iPad). Browser falls back to /apple-touch-icon.png at
  // root for legacy clients (also written by the generator).
  icons: {
    icon: [
      // Browser tab / bookmark — the transparent VenueOS hex mark (BrandMark),
      // which stays legible at 16px. The filled navy tile lives on apple-touch
      // / PWA below, where a solid background is what you want on a home screen.
      //
      // ?v=3 cache-bust (2026-06-05). Chrome caches favicons per-URL extremely
      // aggressively — it largely ignores HTTP cache headers and keeps the
      // first-resolved icon for an origin. After the pre-rebrand *triangle*
      // /favicon.ico was replaced with this hex mark (commits e41830d4 →
      // af356250), browsers that had already cached the triangle kept painting
      // it on tabs. Bumping the query string makes the icon a "new" URL the
      // browser has never cached, forcing a refetch of the current hex mark.
      { url: '/favicon.ico?v=3', sizes: 'any' },
      { url: '/icons/venueos-mark.svg?v=3', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/icons/venue-os-180.png', sizes: '180x180' },
      { url: '/icons/venue-os-167.png', sizes: '167x167' },
      { url: '/icons/venue-os-152.png', sizes: '152x152' },
    ],
    shortcut: '/icons/venue-os-256.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Venue OS',
  },
};

// Next.js 14+ requires themeColor / viewport-meta options in a
// separate viewport export (the metadata export only carries SEO + OG
// fields now). 'black-translucent' Apple status-bar pairs with the
// hex-logo background so the iOS notch / status bar reads as one
// continuous brand surface (the dark indigo at the top of the SVG
// gradient matches the navy header tone).
export const viewport: Viewport = {
  themeColor: '#312e81',
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
      <body className={`${inter.className} ${inter.variable} ${fredoka.variable} ${caveat.variable} min-h-screen bg-slate-50 text-slate-900 antialiased`} suppressHydrationWarning>
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
            {/* Bug-reporter ringbuffers — installs the always-on
                click / route / console / fetch interceptors so the
                BugReporterButton can ship a populated capture bundle.
                Renders nothing; SSR-safe; idempotent across Strict
                Mode re-mounts. */}
            <BugCaptureProviders />
            {/* Floating "Report bug" button. Admins-only (role-gated
                inside the component) and hides itself on immersive
                routes (/panic, /player, /board, …) and unauthenticated
                pages (/login, /signup, …). Mounted at the root layout
                so it works on /super/* pages too — they're outside
                the [schoolId] DashboardLayout chrome. */}
            <BugReporterButton />
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
