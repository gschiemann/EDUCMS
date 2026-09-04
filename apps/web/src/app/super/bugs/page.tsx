"use client";

/**
 * SEC-010 (2026-09-04) — rendered per request so it can carry a CSP nonce.
 *
 * A prerendered route's inline scripts are built without a nonce, so the
 * enforced `script-src 'self' 'nonce-…'` from `src/proxy.ts` would refuse them
 * and this page would render blank. This route holds (or leads directly to) an
 * authenticated session, which is precisely what SEC-010's XSS impact is about,
 * so it is worth one render per request to bring it inside the policy. Public
 * marketing/legal/help pages and `/panic` deliberately stay prerendered and
 * report-only — see CSP_UNNONCEABLE_PREFIXES in src/lib/csp-script-policy.ts.
 *
 * `tools/check-csp-prerender.cjs` fails the build if this ever silently
 * reverts to being prerendered.
 */
export const dynamic = 'force-dynamic';

/**
 * /super/bugs — SUPER_ADMIN bug review queue.
 *
 * Shows every bug across every tenant with screenshot thumbnail,
 * reporter, pathname, status pill, and AI confidence (when PROPOSED+).
 * Status filter pills at the top; auto-refresh every 15s while any
 * NEW / ANALYZING rows are visible (so the operator sees AI analysis
 * land without manual refresh).
 *
 * SUPER_ADMIN gated client-side here AND server-side. The same
 * deny-by-default + mount-tick pattern from /super/page.tsx applies:
 * wait for the user store to hydrate before allowing access.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  Bug,
  CheckCircle2,
  Crown,
  Filter,
  ImageOff,
  Loader2,
  MailWarning,
  XCircle,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useBugList, useEmailConfigured, type BugListFilters } from '@/hooks/use-bugs';
import type { BugStatus } from '@cms/api-types';

const STATUS_FILTERS: Array<{ key: 'ALL' | BugStatus; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'NEW', label: 'New' },
  { key: 'ANALYZING', label: 'Analyzing' },
  { key: 'PROPOSED', label: 'Proposed' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'SHIPPED', label: 'Shipped' },
  { key: 'REJECTED', label: 'Rejected' },
];

export default function SuperBugsPage() {
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const [mounted, setMounted] = useState(false);
  const [activeStatus, setActiveStatus] = useState<'ALL' | BugStatus>('ALL');

  useEffect(() => { setMounted(true); }, []);

  const filters: BugListFilters = activeStatus === 'ALL' ? {} : { status: activeStatus };
  const { data: bugs, isLoading, error } = useBugList(filters);
  // Surface "outbound email isn't configured" so the owner knows why the
  // "new bug filed" + "fix shipped" notification emails aren't arriving.
  // Only banner on an explicit false — undefined (loading / probe error)
  // stays silent to avoid false alarms.
  const { data: emailStatus } = useEmailConfigured();
  const emailUnconfigured = emailStatus?.configured === false;

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (!user || user.role !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white rounded-2xl border border-slate-200 shadow p-8 text-center max-w-sm">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <h1 className="text-lg font-extrabold text-slate-900">Owner-only area</h1>
          <p className="text-sm text-slate-500 mt-1">This bug queue is restricted to platform owners.</p>
          <button onClick={() => router.back()} className="mt-4 px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg">
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <Bug className="w-5 h-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
                Bug reports
                <span className="text-[11px] font-normal text-slate-400 inline-flex items-center gap-1">
                  <Crown className="w-3 h-3 text-amber-500" /> SUPER_ADMIN
                </span>
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Every bug across every tenant — review the AI&apos;s proposed fix, then approve or reject.
              </p>
            </div>
          </div>
          <Link
            href="/super"
            className="text-xs font-bold text-slate-500 hover:text-slate-900"
          >
            ← Back to control panel
          </Link>
        </header>

        {/* Email-not-configured banner — explains why bug-filed / fix-
            shipped notification emails aren't arriving. Mirrors the
            password-reset flow's "email not configured" message. */}
        {emailUnconfigured && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <MailWarning className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
            <div className="text-sm text-amber-900">
              <p className="font-bold">Outbound email isn&apos;t configured on this deployment.</p>
              <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                Bugs still get filed and analyzed here, but the &ldquo;new bug filed&rdquo; and
                &ldquo;fix shipped&rdquo; notification emails won&apos;t be sent. Set
                <code className="mx-1 px-1 py-0.5 rounded bg-amber-100 font-mono text-[11px]">RESEND_API_KEY</code>
                (and verify a sending domain for
                <code className="mx-1 px-1 py-0.5 rounded bg-amber-100 font-mono text-[11px]">EMAIL_FROM</code>)
                on the API to enable delivery. See the env-var table in CLAUDE.md.
              </p>
            </div>
          </div>
        )}

        {/* Status filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-slate-400 mr-1" />
          {STATUS_FILTERS.map((f) => {
            const active = activeStatus === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setActiveStatus(f.key)}
                className={[
                  'px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors',
                  active
                    ? 'bg-slate-900 text-white border border-slate-900'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50',
                ].join(' ')}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {error ? (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700">
            Couldn&apos;t load bug list: {error.message}
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : !bugs || bugs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
            <h2 className="text-base font-extrabold text-slate-800">No bugs in this view</h2>
            <p className="text-sm text-slate-500 mt-1">
              {activeStatus === 'ALL' ? 'Inbox is clear — nothing has been reported yet.' : `No bugs in ${activeStatus} state.`}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-widest">
                <tr>
                  <th className="text-left px-4 py-2.5 font-bold w-[120px]">Screenshot</th>
                  <th className="text-left px-4 py-2.5 font-bold">Bug</th>
                  <th className="text-left px-4 py-2.5 font-bold">Status</th>
                  <th className="text-left px-4 py-2.5 font-bold">AI</th>
                  <th className="text-left px-4 py-2.5 font-bold">Reporter</th>
                  <th className="text-left px-4 py-2.5 font-bold">When</th>
                  <th className="text-right px-4 py-2.5 font-bold"></th>
                </tr>
              </thead>
              <tbody>
                {bugs.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      {b.screenshotUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={b.screenshotUrl}
                          alt=""
                          className="w-24 h-14 object-cover rounded border border-slate-200 bg-slate-100"
                        />
                      ) : (
                        <div className="w-24 h-14 rounded border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center">
                          <ImageOff className="w-3.5 h-3.5 text-slate-300" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <div className="text-sm font-bold text-slate-800 line-clamp-1">
                        {b.description?.trim() || <span className="italic text-slate-400">No description</span>}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5 line-clamp-1">
                        {b.pathname || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <StatusPill status={b.status} />
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <ConfidenceBadge confidence={b.aiConfidence} status={b.status} />
                    </td>
                    <td className="px-4 py-2.5 align-top text-slate-600">
                      <div className="text-[12px] font-semibold text-slate-700">
                        {b.reporter.email || '—'}
                      </div>
                      <div className="text-[11px] text-slate-400">{b.reporter.tenantSlug || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5 align-top text-[11px] text-slate-500">
                      {formatRelative(b.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right align-top">
                      <Link
                        href={`/super/bugs/${b.id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-md bg-slate-900 text-white hover:bg-slate-700"
                      >
                        Review <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pills + helpers ──────────────────────────────────────────────────

const STATUS_STYLES: Record<BugStatus, string> = {
  NEW: 'bg-slate-100 text-slate-700 border-slate-200',
  ANALYZING: 'bg-sky-50 text-sky-700 border-sky-200',
  PROPOSED: 'bg-violet-50 text-violet-700 border-violet-200',
  APPROVED: 'bg-amber-50 text-amber-800 border-amber-200',
  SHIPPED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  DUPLICATE: 'bg-slate-50 text-slate-500 border-slate-200',
};

function StatusPill({ status }: { status: BugStatus }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border',
        STATUS_STYLES[status] || STATUS_STYLES.NEW,
      ].join(' ')}
    >
      {status === 'ANALYZING' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {status === 'SHIPPED' && <CheckCircle2 className="w-2.5 h-2.5" />}
      {status === 'REJECTED' && <XCircle className="w-2.5 h-2.5" />}
      {status}
    </span>
  );
}

function ConfidenceBadge({ confidence, status }: { confidence: number | null; status: BugStatus }) {
  // Confidence is only meaningful once the AI has actually weighed in
  // (PROPOSED or later). Show "—" while waiting.
  if (confidence == null || status === 'NEW' || status === 'ANALYZING') {
    return <span className="text-[11px] text-slate-300">—</span>;
  }
  const tone = confidence >= 80 ? 'emerald' : confidence >= 60 ? 'amber' : 'rose';
  const palette: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <span className={`text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border ${palette[tone]}`}>
      {confidence}%
    </span>
  );
}

/** Compact relative time formatter — "12s ago", "3m ago", "yesterday", etc.
 *  Avoids depending on date-fns (would be a new dep). */
function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(then).toLocaleDateString();
}
