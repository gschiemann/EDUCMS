/**
 * Shared loading state for every [schoolId] route.
 *
 * Before this file, every navigation (click Settings → blank white
 * for 300-1500ms while the client component mounted + fetched). Now
 * Next.js streams this skeleton IMMEDIATELY on route change, so the
 * user sees the shell of the page within a frame. Real content swaps
 * in when the route's data resolves.
 *
 * Keep it zero-JS and zero-dependency — it needs to render as fast
 * as the HTML can parse. No client components, no icons, no fetches.
 */

export default function Loading() {
  return (
    <div className="space-y-6 pb-12 animate-pulse">
      {/* Page header */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="space-y-2">
          <div className="h-8 w-64 rounded-lg bg-slate-200/80" />
          <div className="h-4 w-48 rounded-md bg-slate-100" />
        </div>
        <div className="h-10 w-28 rounded-lg bg-slate-100" />
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-xl bg-slate-200" />
              <div className="w-4 h-4 rounded bg-slate-100" />
            </div>
            <div className="h-3 w-24 rounded bg-slate-100" />
            <div className="h-8 w-16 rounded bg-slate-200/80" />
            <div className="h-3 w-32 rounded bg-slate-100" />
          </div>
        ))}
      </div>

      {/* Body — 2/3 + 1/3 split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="h-4 w-40 rounded bg-slate-200" />
            <div className="h-3 w-20 rounded bg-slate-100" />
          </div>
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-5 py-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/2 rounded bg-slate-200" />
                  <div className="h-2.5 w-1/3 rounded bg-slate-100" />
                </div>
                <div className="h-6 w-16 rounded bg-slate-100 shrink-0" />
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <div className="h-4 w-32 rounded bg-slate-200" />
          </div>
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-5 py-3 flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 rounded bg-slate-200" />
                  <div className="h-2 w-1/2 rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
