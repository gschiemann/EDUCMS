import Link from 'next/link';
import { ReactNode } from 'react';
import { BrandMark } from './BrandMark';
import { Footer } from './Footer';

/**
 * Public marketing shell — VenueOS landing, pricing, help, legal.
 *
 * 2026-05-16 — design refresh: "minimal & precise" (Linear/Vercel
 * territory), professional indigo, no rainbow gradients. The old
 * decorative blur blobs are gone — both for the cleaner look and
 * because stacking `blur` layers under iOS Safari's compositor was
 * a documented mobile-crash vector.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900">
      <PublicHeader />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-30 bg-white/95 md:bg-white/80 md:backdrop-blur-md border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <BrandMark />
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-500">
          <Link href="/#industries" className="hover:text-slate-900 transition">Industries</Link>
          <Link href="/#templates" className="hover:text-slate-900 transition">Templates</Link>
          <Link href="/pricing" className="hover:text-slate-900 transition">Pricing</Link>
          <Link href="/help" className="hover:text-slate-900 transition">Help</Link>
        </nav>
        <div className="flex items-center gap-1.5">
          <Link
            href="/login"
            className="text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg transition-colors"
          >
            Start free trial
          </Link>
        </div>
      </div>
    </header>
  );
}
