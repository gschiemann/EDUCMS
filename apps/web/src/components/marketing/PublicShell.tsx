import Link from 'next/link';
import { ReactNode } from 'react';
import { BrandMark } from './BrandMark';
import { Footer } from './Footer';

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900 relative overflow-x-hidden">
      {/* Decorative blobs */}
      <div aria-hidden className="pointer-events-none absolute -top-32 -left-40 w-[28rem] h-[28rem] rounded-full bg-indigo-200/40 blur-3xl -z-10" />
      <div aria-hidden className="pointer-events-none absolute top-64 -right-40 w-[32rem] h-[32rem] rounded-full bg-violet-200/40 blur-3xl -z-10" />
      <div aria-hidden className="pointer-events-none absolute top-[120vh] left-1/3 w-[24rem] h-[24rem] rounded-full bg-sky-200/30 blur-3xl -z-10" />

      <PublicHeader />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/70 border-b border-slate-200/60">
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
