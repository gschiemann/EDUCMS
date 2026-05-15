import Link from 'next/link';
import { ReactNode } from 'react';
import { BrandMark } from './BrandMark';
import { Footer } from './Footer';

export function PublicShell({ children }: { children: ReactNode }) {
  // 2026-05-15 — operator reported "scrolling the main landing page
  // on mobile device causes safari to crash". Root cause: stacking
  // 3× `blur-3xl` decorative blobs UNDER a `backdrop-blur-xl` sticky
  // header UNDER 4 simultaneously-loading <iframe> template previews
  // (Hero + 3-tile Gallery), each running a CSS-animated rainbow
  // scene at 1920×1080. iOS Safari's compositor exhausts the GPU
  // memory pool inside a few seconds of scrolling on phones (the
  // 4 GiB iPhone 12 / 13 baseline). Cumulative cost — none of these
  // by themselves crashes, but together they OOM the renderer.
  //
  // Mitigation here (zero visual change on desktop):
  //   - Drop `blur-3xl` to `blur-2xl` so each blob's filter cost
  //     is ~2× cheaper on iOS Safari (4× the radius = 16× cost in
  //     CoreGraphics gaussian blur, per WebKit perf docs).
  //   - Drop the third (lowest, bg-sky) blob entirely; it sits
  //     well below the fold and only fires on long pages.
  // (Header `backdrop-blur` is handled in PublicHeader below.)
  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900 relative overflow-x-hidden">
      {/* Decorative blobs — toned down for iOS Safari memory pressure */}
      <div aria-hidden className="pointer-events-none absolute -top-32 -left-40 w-[28rem] h-[28rem] rounded-full bg-indigo-200/40 blur-2xl -z-10" />
      <div aria-hidden className="pointer-events-none hidden md:block absolute top-64 -right-40 w-[32rem] h-[32rem] rounded-full bg-violet-200/40 blur-2xl -z-10" />

      <PublicHeader />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}

export function PublicHeader() {
  // Sticky + `backdrop-filter` on iOS Safari triggers a full
  // re-composite of every layer behind the header on every scroll
  // event. With 4 iframes + animated rainbow content + decorative
  // blobs behind, that's enough to crash the tab. Switch to a
  // solid (mostly-opaque) bg on mobile; keep the glass effect on
  // md+ where Safari handles it without OOM (desktop GPU + RAM).
  return (
    <header className="sticky top-0 z-30 bg-white/95 md:bg-white/70 md:backdrop-blur-xl border-b border-slate-200/60">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <BrandMark />
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
          <Link href="/#features" className="hover:text-slate-900 transition">Features</Link>
          <Link href="/pricing" className="hover:text-slate-900 transition">Pricing</Link>
          <Link href="/help" className="hover:text-slate-900 transition">Help</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="text-sm font-medium text-slate-700 hover:text-slate-900 px-3 py-2">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 px-4 py-2 rounded-xl shadow-lg shadow-indigo-500/20 transition"
          >
            Start free trial
          </Link>
        </div>
      </div>
    </header>
  );
}
