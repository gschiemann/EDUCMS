import Link from 'next/link';

export const metadata = {
  title: 'Page not found — VenueOS',
};

/**
 * Global 404. The app router renders this for any unmatched route —
 * a mistyped URL or a stale link. Standalone (no PublicShell / no
 * Sidebar, since the route group isn't known here), so it's a
 * self-contained full-screen page in the VenueOS navy/indigo style.
 */
export default function NotFound() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center text-center px-8"
      style={{ background: '#070a14' }}
    >
      <div className="text-7xl font-extrabold leading-none text-indigo-500">404</div>
      <h1 className="mt-4 text-2xl font-semibold text-slate-100">
        This page doesn&rsquo;t exist
      </h1>
      <p className="mt-2 max-w-md text-sm text-slate-400">
        The page you&rsquo;re looking for may have moved, or the link was mistyped.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
      >
        Back to VenueOS
      </Link>
    </div>
  );
}
