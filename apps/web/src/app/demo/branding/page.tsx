/**
 * Public demo — /demo/branding
 *
 * No auth required. Paste a URL, watch the CMS re-skin live. Adoption
 * is gated (the wizard shows the button disabled) because persisting
 * requires an authed tenant context. This page is the single biggest
 * friction-killer for the pilot conversation: superintendents see
 * "our CMS looks like our school" before they even sign up.
 */
import type { Metadata } from 'next';
import { BrandingWizard } from '@/components/branding/BrandingWizard';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Try auto-branding · EduSignage',
  description: 'Paste your school website URL — we instantly re-skin the CMS to match your brand.',
};

export default function DemoBrandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="px-6 py-4 flex items-center justify-between border-b border-slate-200 bg-white/70 backdrop-blur sticky top-0 z-10">
        <Link href="/" className="font-bold text-lg">EduSignage</Link>
        <div className="flex gap-2 text-sm items-center">
          <span className="text-slate-500">Try the live demo</span>
          <Link href="/signup" className="bg-indigo-600 text-white px-3 py-1.5 rounded-md hover:bg-indigo-700">Start a pilot</Link>
        </div>
      </header>

      <div className="text-center py-10 px-4">
        <div className="inline-block px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold mb-3 tracking-wide uppercase">Live demo</div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Your CMS. Your school&apos;s brand. In 10 seconds.</h1>
        <p className="mt-3 text-slate-600 max-w-2xl mx-auto">
          Paste your school or district website below. We&apos;ll scan your logo, colors, and
          typography and re-paint the CMS live in the preview pane. No signup needed.
        </p>
      </div>

      <BrandingWizard mode="demo" />

      <footer className="text-center text-xs text-slate-500 py-8">
        Never stores anything. Scraping is SSRF-guarded and rate-limited. Adoption requires a signed-in account.
      </footer>
    </div>
  );
}
