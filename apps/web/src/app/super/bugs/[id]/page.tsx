"use client";

/**
 * /super/bugs/[id] — single-bug review surface.
 *
 * Left half = clickable screenshot. Right half = collapsible sections
 * for Reporter, URL, Browser, Console errors, Network failures, Recent
 * breadcrumbs, Audit log, Infra health. Below that = the AI analysis
 * card (rootCause, confidence chip, alternatives, file diffs). Bottom
 * bar = [Approve & Ship] [Iterate (with notes)] [Reject (with reason)].
 *
 * Polls every 5s while ANALYZING so the operator sees the AI's diff
 * land without manual refresh.
 *
 * SUPER_ADMIN only — hydration-safe guard mirrors /super/page.tsx.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitMerge,
  ImageOff,
  Loader2,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import {
  useApproveBug,
  useBugDetail,
  useIterateBug,
  useRejectBug,
} from '@/hooks/use-bugs';
import type {
  BugAiFileChange,
  BugAuditSnapshot,
  BugBreadcrumb,
  BugConsoleEntry,
  BugDetail,
  BugNetworkFailure,
  BugReactQueryEntry,
  BugStatus,
} from '@cms/api-types';

export default function SuperBugDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const user = useAppStore((s) => s.user);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const { data: bug, isLoading, error } = useBugDetail(id);
  const approve = useApproveBug(id);
  const reject = useRejectBug(id);
  const iterate = useIterateBug(id);

  const [rejectReason, setRejectReason] = useState('');
  const [iterateNotes, setIterateNotes] = useState('');
  const [approveNotes, setApproveNotes] = useState('');
  const [actionUi, setActionUi] = useState<'none' | 'reject' | 'iterate' | 'approve'>('none');
  const [actionResult, setActionResult] = useState<{ kind: 'approve'; prUrl: string | null; branchName: string | null } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
          <p className="text-sm text-slate-500 mt-1">This bug detail page is restricted to platform owners.</p>
          <button onClick={() => router.back()} className="mt-4 px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg">
            Go back
          </button>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-4xl mx-auto bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700">
          Couldn't load bug: {error.message}
        </div>
      </div>
    );
  }
  if (isLoading || !bug) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-4xl mx-auto flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  const handleApprove = async () => {
    setActionError(null);
    try {
      const res = await approve.mutateAsync({ notes: approveNotes.trim() || undefined });
      setActionResult({ kind: 'approve', prUrl: res.prUrl, branchName: res.branchName });
      setActionUi('none');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Approve failed');
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setActionError('Please give a rejection reason.');
      return;
    }
    setActionError(null);
    try {
      await reject.mutateAsync({ reason: rejectReason.trim() });
      router.push('/super/bugs');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Reject failed');
    }
  };

  const handleIterate = async () => {
    if (!iterateNotes.trim()) {
      setActionError('Please give iteration notes — the AI uses these as a hint.');
      return;
    }
    setActionError(null);
    try {
      await iterate.mutateAsync({ notes: iterateNotes.trim() });
      setActionUi('none');
      setIterateNotes('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Iterate failed');
    }
  };

  // 2026-05-27 — The analyzer service writes an ERROR shape into
  // ai_analysis when the AI call can't run (ANTHROPIC_API_KEY unset,
  // daily cap reached, transient API failure). That shape is
  // `{ kind: 'unconfigured' | 'cap-reached' | 'failed', error: string }`
  // and DOES NOT satisfy BugAiAnalysis (no rootCause / filesAffected /
  // confidence). Splitting them here so the render path can show the
  // notice without crashing on `ai.filesAffected.length`.
  const rawAnalysis = bug.aiAnalysis as
    | (BugDetail['aiAnalysis'] & { error?: string; kind?: string })
    | null;
  const aiError =
    rawAnalysis && typeof rawAnalysis === 'object' && 'error' in rawAnalysis && rawAnalysis.error
      ? {
          kind: (rawAnalysis.kind as 'unconfigured' | 'cap-reached' | 'failed' | undefined) ?? 'failed',
          error: String(rawAnalysis.error),
        }
      : null;
  const ai = aiError ? null : rawAnalysis;
  const isAnalyzing = bug.status === 'ANALYZING' || bug.status === 'NEW';
  const isTerminal = bug.status === 'SHIPPED' || bug.status === 'REJECTED' || bug.status === 'DUPLICATE';

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-5">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <Link
              href="/super/bugs"
              className="mt-1 p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              aria-label="Back to bug list"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
                <Bug className="w-5 h-5 text-slate-700" /> Bug{' '}
                <span className="font-mono text-sm text-slate-500 font-normal">{bug.id.slice(0, 8)}</span>
                <StatusPill status={bug.status} />
              </h1>
              <p className="text-sm text-slate-600 mt-0.5 max-w-2xl">
                {bug.description?.trim() || <span className="italic text-slate-400">No description from reporter.</span>}
              </p>
            </div>
          </div>
          {bug.aiCostUsd != null && (
            <div className="text-[11px] text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
              AI spend so far: <span className="font-bold text-slate-700">${bug.aiCostUsd.toFixed(4)}</span>
            </div>
          )}
        </header>

        {/* SCREENSHOT + CONTEXT */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Screenshot</h2>
              {bug.screenshotUrl && (
                <a
                  href={bug.screenshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800"
                >
                  Open full-size <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <div className="p-3 bg-slate-50">
              {bug.screenshotUrl ? (
                <a href={bug.screenshotUrl} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={bug.screenshotUrl}
                    alt="Bug screenshot"
                    className="w-full h-auto rounded-lg border border-slate-200 bg-white"
                  />
                </a>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <ImageOff className="w-8 h-8 mb-2" />
                  <span className="text-xs">No screenshot captured</span>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-3">
            <ReporterCard bug={bug} />
            <ContextSections bug={bug} />
          </div>
        </div>

        {/* AI ANALYSIS */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-violet-100 text-violet-700 text-[10px] font-extrabold">
                AI
              </span>
              Proposed fix
            </h2>
            {ai && !aiError && <ConfidenceBadge confidence={ai.confidence} />}
          </div>
          {!ai || aiError ? (
            <div className="p-8 text-center">
              {/* 2026-05-27 — precedence matters here.
                  `isAnalyzing` is true when status==='NEW' OR 'ANALYZING',
                  which OVERLAPS with the case where the analyzer already
                  ran and wrote an error shape (status reverts to NEW on
                  failure). Check aiError FIRST so the operator sees the
                  "AI not configured" notice + Claude review panel,
                  NOT a forever spinner. */}
              {aiError ? (
                // 2026-05-27 — the analyzer wrote an error shape (e.g.
                // {kind:'unconfigured', error:'AI not configured for this
                // deploy (ANTHROPIC_API_KEY unset)'}) instead of a full
                // BugAiAnalysis. Render it as a notice rather than crash
                // on `ai.filesAffected.length` below.
                <>
                  <AlertCircle className="w-6 h-6 mx-auto text-amber-500 mb-3" />
                  <p className="text-sm font-bold text-slate-700">
                    {aiError.kind === 'unconfigured'
                      ? 'AI analysis not configured'
                      : aiError.kind === 'cap-reached'
                        ? 'Daily AI budget reached'
                        : 'AI analysis failed'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
                    {aiError.error}
                  </p>
                  {aiError.kind === 'unconfigured' && (
                    <div className="text-[11px] text-slate-400 mt-3 space-y-2">
                      <p>
                        Set <code className="px-1.5 py-0.5 bg-slate-100 rounded font-mono">ANTHROPIC_API_KEY</code>
                        {' '}on the API service for automatic analysis — or use the manual path below.
                      </p>
                    </div>
                  )}

                  {/* 2026-05-27 — Operator: "what about just feeding the
                      bug info back into the app somewhere that you have
                      access to so that you can review the bug and all
                      the collected content and we dont need an API?"
                      Right. The Anthropic call was the lossy part —
                      Claude (this chat session) has the whole codebase
                      indexed already. Just hand the bundle over.

                      Button copies a self-contained markdown summary
                      (description + reporter + browser + breadcrumbs +
                      console errors + network failures + audit log +
                      infra state + bug-id deeplink) to the operator's
                      clipboard. Paste into Claude chat → root cause +
                      code fix + commit + push, all in one turn. */}
                  <ClaudeReviewPanel bug={bug} />
                </>
              ) : isAnalyzing ? (
                // No aiError + no valid ai + still in NEW/ANALYZING =
                // the analyzer hasn't run yet (race between POST + the
                // fire-and-forget analyzer). Show the spinner; the
                // page polls every 5s while ANALYZING so the right
                // state lands automatically once the analyzer writes.
                <>
                  <Loader2 className="w-6 h-6 mx-auto animate-spin text-slate-400 mb-3" />
                  <p className="text-sm font-bold text-slate-700">Analyzing bug…</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Polling every 5s. Auto-analyzer is reading the capture bundle.
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-500">No AI analysis available for this bug.</p>
              )}
            </div>
          ) : (
            <div className="p-5 space-y-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Root cause</div>
                <p className="text-sm text-slate-800 leading-relaxed">{ai.rootCause}</p>
              </div>

              {ai.testPlan && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-1">Verify with</div>
                  <pre className="text-[11px] font-mono text-emerald-900 whitespace-pre-wrap">{ai.testPlan}</pre>
                </div>
              )}

              {ai.alternatives && ai.alternatives.length > 0 && (
                <CollapsibleSection title={`Alternatives considered (${ai.alternatives.length})`}>
                  <ul className="space-y-2 mt-2">
                    {ai.alternatives.map((alt, i) => (
                      <li key={i} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            #{i + 1}
                          </span>
                          <ConfidenceBadge confidence={alt.confidence} small />
                        </div>
                        <p className="text-xs text-slate-700">{alt.rootCause}</p>
                      </li>
                    ))}
                  </ul>
                </CollapsibleSection>
              )}

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Files affected ({ai.filesAffected.length})
                </div>
                <div className="space-y-3">
                  {ai.filesAffected.map((f) => (
                    <FileChangeCard key={f.filePath} change={f} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ACTION RESULT BANNER */}
        {actionResult && actionResult.kind === 'approve' && (
          <section className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
              <div className="flex-1 text-sm text-emerald-900">
                <div className="font-extrabold">Approved.</div>
                {actionResult.prUrl ? (
                  <p className="mt-1">
                    Pull request opened:{' '}
                    <a
                      href={actionResult.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold underline hover:text-emerald-700"
                    >
                      {actionResult.prUrl} <ExternalLink className="inline w-3 h-3" />
                    </a>
                  </p>
                ) : actionResult.branchName ? (
                  <p className="mt-1">
                    Branch <code className="bg-emerald-100 px-1 rounded">{actionResult.branchName}</code> created.
                    GitHub PR integration isn't configured — push manually or wire up the integration.
                  </p>
                ) : (
                  <p className="mt-1">
                    GitHub integration not configured. The diff is above — apply manually.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ACTION BAR */}
        {!isTerminal && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            {actionUi === 'none' ? (
              <div className="flex items-center justify-end gap-2 flex-wrap">
                {bug.status === 'REJECTED' || bug.status === 'DUPLICATE' ? null : (
                  <>
                    <button
                      type="button"
                      onClick={() => setActionUi('reject')}
                      disabled={!ai || approve.isPending || reject.isPending || iterate.isPending}
                      className="px-4 py-2 text-xs font-bold rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 disabled:opacity-50"
                    >
                      <XCircle className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" />
                      Reject…
                    </button>
                    <button
                      type="button"
                      onClick={() => setActionUi('iterate')}
                      disabled={!ai || approve.isPending || reject.isPending || iterate.isPending}
                      className="px-4 py-2 text-xs font-bold rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700 disabled:opacity-50"
                    >
                      <RotateCcw className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" />
                      Iterate (with notes)…
                    </button>
                    <button
                      type="button"
                      onClick={() => setActionUi('approve')}
                      disabled={!ai || approve.isPending || reject.isPending || iterate.isPending}
                      className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <GitMerge className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" />
                      Approve & ship
                    </button>
                  </>
                )}
              </div>
            ) : actionUi === 'reject' ? (
              <div className="space-y-2">
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Why are you rejecting?</span>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={3}
                    placeholder="Wrong file / not actually a bug / can't reproduce / …"
                    className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-300"
                  />
                </label>
                {actionError && <ErrorBanner message={actionError} />}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setActionUi('none'); setActionError(null); }}
                    className="px-3 py-2 text-xs font-bold text-slate-600"
                    disabled={reject.isPending}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleReject}
                    disabled={reject.isPending}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
                  >
                    {reject.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Reject bug
                  </button>
                </div>
              </div>
            ) : actionUi === 'iterate' ? (
              <div className="space-y-2">
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    What should the AI rethink?
                  </span>
                  <textarea
                    value={iterateNotes}
                    onChange={(e) => setIterateNotes(e.target.value)}
                    rows={3}
                    placeholder="The fix should also handle X / it should patch the API, not the FE / …"
                    className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300"
                  />
                </label>
                {actionError && <ErrorBanner message={actionError} />}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setActionUi('none'); setActionError(null); }}
                    className="px-3 py-2 text-xs font-bold text-slate-600"
                    disabled={iterate.isPending}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleIterate}
                    disabled={iterate.isPending}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60"
                  >
                    {iterate.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Re-analyze
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    PR description (optional)
                  </span>
                  <textarea
                    value={approveNotes}
                    onChange={(e) => setApproveNotes(e.target.value)}
                    rows={3}
                    placeholder="Anything extra to include in the PR body…"
                    className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300"
                  />
                </label>
                {actionError && <ErrorBanner message={actionError} />}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setActionUi('none'); setActionError(null); }}
                    className="px-3 py-2 text-xs font-bold text-slate-600"
                    disabled={approve.isPending}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={approve.isPending}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {approve.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <GitBranch className="w-3.5 h-3.5" />
                    Open PR
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* TERMINAL STATE BANNERS */}
        {bug.status === 'SHIPPED' && (
          <section className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-900">
            <div className="flex items-center gap-2 font-extrabold">
              <CheckCircle2 className="w-4 h-4" /> Shipped
            </div>
            {bug.fixPrNumber && <p className="mt-1">PR #{bug.fixPrNumber} merged.</p>}
            {bug.fixCommitSha && (
              <p className="text-[11px] font-mono mt-0.5">Commit: {bug.fixCommitSha}</p>
            )}
            {bug.shippedAt && (
              <p className="text-[11px] text-emerald-700 mt-0.5">{new Date(bug.shippedAt).toLocaleString()}</p>
            )}
          </section>
        )}

        {(bug.status === 'REJECTED' || bug.status === 'DUPLICATE') && (
          <section className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-900">
            <div className="flex items-center gap-2 font-extrabold">
              <XCircle className="w-4 h-4" /> {bug.status === 'DUPLICATE' ? 'Marked as duplicate' : 'Rejected'}
            </div>
            {bug.rejectedReason && <p className="mt-1">{bug.rejectedReason}</p>}
          </section>
        )}
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────

function ReporterCard({ bug }: { bug: BugDetail }) {
  const r = bug.capturedContext.reporter;
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Reporter</h3>
      <div className="text-sm font-bold text-slate-800">{r.email || '—'}</div>
      <div className="text-[11px] text-slate-500">
        {r.role} · {r.tenantSlug || '—'}
      </div>
      <div className="text-[11px] text-slate-400 font-mono mt-1.5 break-all">
        <span className="font-bold text-slate-500">URL:</span> {bug.capturedContext.url || bug.pathname || '—'}
      </div>
      {bug.capturedContext.pageTitle && (
        <div className="text-[11px] text-slate-400 mt-0.5">
          <span className="font-bold text-slate-500">Page:</span> {bug.capturedContext.pageTitle}
        </div>
      )}
    </div>
  );
}

function ContextSections({ bug }: { bug: BugDetail }) {
  const c = bug.capturedContext;
  const s = bug.serverContext;
  return (
    <div className="space-y-2">
      <CollapsibleSection title={`Browser & device`}>
        <KeyValueList
          rows={[
            ['User agent', c.browser.userAgent],
            ['Language', c.browser.language],
            ['Viewport', `${c.browser.viewport.w} × ${c.browser.viewport.h}`],
            ['DPR', String(c.browser.dpr)],
            ['Chromium', c.browser.chromiumMajor ? `v${c.browser.chromiumMajor}` : 'Not Chromium'],
          ]}
        />
      </CollapsibleSection>

      {c.consoleEntries.length > 0 && (
        <CollapsibleSection title={`Console errors (${c.consoleEntries.length})`} defaultOpen>
          <ConsoleList entries={c.consoleEntries} />
        </CollapsibleSection>
      )}

      {c.networkFailures.length > 0 && (
        <CollapsibleSection title={`Network failures (${c.networkFailures.length})`} defaultOpen>
          <NetworkList entries={c.networkFailures} />
        </CollapsibleSection>
      )}

      {c.breadcrumbs.length > 0 && (
        <CollapsibleSection title={`Breadcrumbs (${c.breadcrumbs.length})`}>
          <BreadcrumbList entries={c.breadcrumbs} />
        </CollapsibleSection>
      )}

      {c.reactQuery.length > 0 && (
        <CollapsibleSection title={`React Query cache (${c.reactQuery.length})`}>
          <ReactQueryList entries={c.reactQuery} />
        </CollapsibleSection>
      )}

      {c.featureFlags && Object.keys(c.featureFlags).length > 0 && (
        <CollapsibleSection title={`Feature flags`}>
          <KeyValueList rows={Object.entries(c.featureFlags).map(([k, v]) => [k, JSON.stringify(v)])} />
        </CollapsibleSection>
      )}

      {s && (
        <>
          <CollapsibleSection title={`Infra health`}>
            <KeyValueList
              rows={[
                ['Postgres', s.infraHealth.db],
                ['Redis', s.infraHealth.redis],
                ['API commit', s.apiCommitSha || '—'],
                ['API uptime', s.apiUptimeSec != null ? `${s.apiUptimeSec}s` : '—'],
              ]}
            />
          </CollapsibleSection>

          {s.license && (
            <CollapsibleSection title={`License`}>
              <KeyValueList
                rows={[
                  ['Tier', s.license.tier || '—'],
                  ['Seats', `${s.license.currentSeats ?? 0} / ${s.license.seatLimit ?? 0}`],
                  ['Expires', s.license.expiresAt || '—'],
                ]}
              />
            </CollapsibleSection>
          )}

          {s.reporterAuditLog.length > 0 && (
            <CollapsibleSection title={`Reporter audit log (${s.reporterAuditLog.length})`}>
              <AuditList entries={s.reporterAuditLog} />
            </CollapsibleSection>
          )}

          {s.tenantAuditLog.length > 0 && (
            <CollapsibleSection title={`Tenant audit log (${s.tenantAuditLog.length})`}>
              <AuditList entries={s.tenantAuditLog} />
            </CollapsibleSection>
          )}
        </>
      )}
    </div>
  );
}

interface CollapsibleProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({ title, defaultOpen = false, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left"
      >
        <span className="text-xs font-bold text-slate-700">{title}</span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
      </button>
      {open && <div className="px-4 pb-3 border-t border-slate-100 pt-2.5">{children}</div>}
    </div>
  );
}

function KeyValueList({ rows }: { rows: Array<[string, string | number]> }) {
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-[11px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500 font-bold">{k}</dt>
          <dd className="col-span-2 text-slate-700 font-mono break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ConsoleList({ entries }: { entries: BugConsoleEntry[] }) {
  return (
    <ul className="space-y-1.5">
      {entries.slice().reverse().map((e, i) => (
        <li key={i} className={`text-[11px] font-mono p-2 rounded border ${
          e.level === 'error'
            ? 'bg-rose-50 border-rose-200 text-rose-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[9px] font-bold uppercase tracking-wider">{e.level}</span>
            <span className="text-[9px] text-slate-400">{relativeMs(e.ts)}</span>
          </div>
          <pre className="whitespace-pre-wrap break-words">{e.message}</pre>
        </li>
      ))}
    </ul>
  );
}

function NetworkList({ entries }: { entries: BugNetworkFailure[] }) {
  return (
    <ul className="space-y-1.5">
      {entries.slice().reverse().map((e, i) => (
        <li key={i} className="text-[11px] font-mono p-2 rounded border bg-slate-50 border-slate-200">
          <div className="flex items-center gap-2">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
              e.status === null
                ? 'bg-rose-200 text-rose-800'
                : e.status >= 500
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-amber-100 text-amber-800'
            }`}>
              {e.status ?? 'NET'}
            </span>
            <span className="font-bold">{e.method}</span>
            <span className="text-[10px] text-slate-400 ml-auto">{e.durationMs}ms · {relativeMs(e.ts)}</span>
          </div>
          <div className="text-slate-700 break-all mt-0.5">{e.url}</div>
          {e.message && <pre className="text-[10px] text-slate-500 mt-1 whitespace-pre-wrap">{e.message}</pre>}
        </li>
      ))}
    </ul>
  );
}

function BreadcrumbList({ entries }: { entries: BugBreadcrumb[] }) {
  return (
    <ul className="space-y-1">
      {entries.slice().reverse().map((e, i) => (
        <li key={i} className="text-[11px] flex items-start gap-2">
          <span className="text-[9px] uppercase font-bold text-slate-400 w-12 shrink-0 mt-0.5">{e.type}</span>
          <span className="text-slate-700 flex-1 break-all">{e.label}</span>
          <span className="text-[9px] text-slate-400 shrink-0 mt-0.5">{relativeMs(e.ts)}</span>
        </li>
      ))}
    </ul>
  );
}

function ReactQueryList({ entries }: { entries: BugReactQueryEntry[] }) {
  return (
    <ul className="space-y-1">
      {entries.map((e, i) => (
        <li key={i} className="text-[11px] flex items-start gap-2 font-mono">
          <span className={`text-[9px] uppercase font-bold px-1 rounded shrink-0 ${
            e.state === 'error' ? 'bg-rose-100 text-rose-700'
              : e.state === 'success' ? 'bg-emerald-100 text-emerald-700'
              : e.state === 'loading' ? 'bg-sky-100 text-sky-700'
              : 'bg-slate-100 text-slate-500'
          }`}>{e.state}</span>
          <span className="text-slate-700 flex-1 break-all">{e.queryKey}</span>
        </li>
      ))}
    </ul>
  );
}

function AuditList({ entries }: { entries: BugAuditSnapshot[] }) {
  return (
    <ul className="space-y-1">
      {entries.map((e, i) => (
        <li key={i} className="text-[11px] flex items-start gap-2">
          <span className="text-[9px] uppercase font-bold text-slate-400 w-32 shrink-0 mt-0.5">
            {new Date(e.ts).toLocaleTimeString()}
          </span>
          <span className="text-slate-700 flex-1 break-all">
            <span className="font-bold">{e.action}</span>
            {e.targetType && <span className="text-slate-500"> {e.targetType}</span>}
            {e.targetId && <span className="text-slate-400 font-mono"> {e.targetId.slice(0, 8)}</span>}
            {e.details && <span className="block text-[10px] text-slate-400 mt-0.5 font-mono">{e.details}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FileChangeCard({ change }: { change: BugAiFileChange }) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="bg-slate-100 px-3 py-2 border-b border-slate-200">
        <div className="font-mono text-xs font-bold text-slate-800 break-all">{change.filePath}</div>
        {change.reason && <div className="text-[11px] text-slate-600 mt-0.5">{change.reason}</div>}
      </div>
      <pre className="text-[11px] font-mono whitespace-pre-wrap bg-slate-900 text-slate-100 p-3 overflow-x-auto max-h-[400px]">
        {change.diff}
      </pre>
    </div>
  );
}

function ConfidenceBadge({ confidence, small = false }: { confidence: number; small?: boolean }) {
  const tone = confidence >= 80 ? 'emerald' : confidence >= 60 ? 'amber' : 'rose';
  const palette: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 font-bold border rounded-full ${palette[tone]} ${
        small ? 'text-[9px] px-1.5 py-0' : 'text-[10px] px-2 py-0.5 tracking-wider'
      }`}
    >
      {confidence}% confidence
    </span>
  );
}

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
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
        STATUS_STYLES[status] || STATUS_STYLES.NEW
      }`}
    >
      {status === 'ANALYZING' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {status}
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 flex items-start gap-2">
      <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
      <div className="text-[11px] text-rose-700">{message}</div>
    </div>
  );
}

function relativeMs(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleString();
}

// 2026-05-27 — Manual-review escape hatch. Renders a panel below the
// "AI not configured" notice that:
//
//   1. Builds a self-contained markdown summary of the bug (bundle).
//   2. Has [Copy bundle for Claude] → puts bundle on clipboard.
//   3. Tells the operator how to use it: paste in chat, Claude reads,
//      proposes fix in chat, writes the actual code, commits. The
//      bug record stays in NEW status until Claude posts an analysis
//      back via POST /api/v1/bugs/:id/manual-analysis.
//
// The bundle is intentionally markdown (not JSON) so it's readable
// when pasted into any chat surface — Claude Code session, claude.ai,
// even a Slack DM if needed.
function ClaudeReviewPanel({ bug }: { bug: BugDetail }) {
  const [copied, setCopied] = useState<'none' | 'ok' | 'error'>('none');

  const bundle = useMemo(() => buildBugBundleMarkdown(bug), [bug]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(bundle);
      setCopied('ok');
      setTimeout(() => setCopied('none'), 2500);
    } catch {
      setCopied('error');
      setTimeout(() => setCopied('none'), 2500);
    }
  };

  return (
    <div className="mt-5 mx-auto max-w-2xl bg-indigo-50/60 border border-indigo-200 rounded-xl p-4 text-left">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-[12px] font-extrabold text-indigo-900 flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-indigo-600 text-white text-[9px] font-extrabold">
            C
          </span>
          Send to Claude for manual review
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className={
            'inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors ' +
            (copied === 'ok'
              ? 'bg-emerald-600 text-white'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white')
          }
        >
          {copied === 'ok' ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5" />
              Copied
            </>
          ) : copied === 'error' ? (
            <>
              <XCircle className="w-3.5 h-3.5" />
              Copy failed
            </>
          ) : (
            <>
              <GitBranch className="w-3.5 h-3.5" />
              Copy bundle
            </>
          )}
        </button>
      </div>
      <p className="text-[11px] text-indigo-900/70 leading-relaxed">
        Click <span className="font-bold">Copy bundle</span>, then paste into
        your Claude Code chat with{' '}
        <code className="px-1 py-0.5 bg-white/70 rounded font-mono text-[10px]">
          look at this bug
        </code>
        . Claude reads the captured context, finds the root cause, writes the
        fix, commits, and pushes. You see the deploy land. The bug record
        becomes the audit trail.
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-indigo-700 hover:text-indigo-900">
          Preview the bundle ({bundle.length.toLocaleString()} chars)
        </summary>
        <pre className="mt-2 p-3 bg-white border border-indigo-100 rounded-lg text-[10px] font-mono text-slate-700 whitespace-pre-wrap max-h-72 overflow-y-auto">
          {bundle}
        </pre>
      </details>
    </div>
  );
}

/** Render a self-contained markdown summary of a Bug record. The
 *  output is what the operator copies → pastes into Claude chat → I
 *  read → propose root cause + fix. Includes every field the
 *  analyzer would have seen plus operational context (commit SHA,
 *  infra health, last audit log rows) so I don't have to re-query. */
function buildBugBundleMarkdown(bug: BugDetail): string {
  const c = bug.capturedContext;
  const s = bug.serverContext;
  const r = c?.reporter;
  const b = c?.browser;
  const lines: string[] = [];

  lines.push(`# Bug Report ${bug.id}`);
  lines.push('');
  lines.push(`**Status:** ${bug.status}`);
  lines.push(`**Filed:** ${bug.createdAt}`);
  if (r) {
    lines.push(
      `**Reporter:** ${r.email ?? '(unknown)'} (${r.role ?? '?'}) — tenant **${r.tenantSlug ?? '(none)'}** [${r.tenantVertical ?? '?'}]`,
    );
  }
  if (c?.pathname) lines.push(`**Where:** \`${c.pathname}\` (\`${c.url ?? ''}\`)`);
  if (c?.pageTitle) lines.push(`**Page title:** ${c.pageTitle}`);
  if (s?.apiCommitSha) lines.push(`**API commit at file time:** \`${s.apiCommitSha}\``);
  if (typeof s?.apiUptimeSec === 'number') lines.push(`**API uptime:** ${s.apiUptimeSec}s`);
  if (s?.infraHealth) {
    lines.push(
      `**Infra:** DB ${s.infraHealth.db}, Redis ${s.infraHealth.redis}`,
    );
  }
  if (s?.license) {
    lines.push(
      `**License:** ${s.license.tier ?? '?'} (${s.license.currentSeats ?? '?'}/${s.license.seatLimit ?? '?'} seats)`,
    );
  }
  lines.push('');

  lines.push('## What the operator said');
  lines.push('');
  lines.push(bug.description ? `> ${bug.description}` : '_(no description provided)_');
  lines.push('');

  if (bug.screenshotUrl) {
    lines.push('## Screenshot');
    lines.push(`![screenshot](${bug.screenshotUrl})`);
    lines.push('');
  }

  if (b) {
    lines.push('## Browser');
    lines.push(`- **UA:** \`${b.userAgent}\``);
    lines.push(`- **Viewport:** ${b.viewport?.w}×${b.viewport?.h} (DPR ${b.dpr ?? '?'})`);
    lines.push(`- **Language:** ${b.language}`);
    if (b.chromiumMajor != null) lines.push(`- **Chromium major:** ${b.chromiumMajor}`);
    lines.push('');
  }

  const consoleEntries = c?.consoleEntries ?? [];
  if (consoleEntries.length > 0) {
    lines.push(`## Recent console errors (${consoleEntries.length})`);
    consoleEntries.slice(0, 20).forEach((e) => {
      const ts = new Date(e.ts).toISOString();
      lines.push(`- \`${e.level}\` @ ${ts} — ${e.message.slice(0, 300)}`);
    });
    lines.push('');
  }

  const networkFailures = c?.networkFailures ?? [];
  if (networkFailures.length > 0) {
    lines.push(`## Recent failed network requests (${networkFailures.length})`);
    networkFailures.slice(0, 20).forEach((nf) => {
      lines.push(
        `- \`${nf.method} ${nf.url}\` → ${nf.status ?? 'no-resp'} (${nf.durationMs}ms)${nf.message ? ` — ${nf.message.slice(0, 200)}` : ''}`,
      );
    });
    lines.push('');
  }

  const breadcrumbs = c?.breadcrumbs ?? [];
  if (breadcrumbs.length > 0) {
    lines.push(`## Breadcrumbs (${breadcrumbs.length})`);
    breadcrumbs.slice(-30).forEach((bc) => {
      const ago = Math.round((Date.now() - bc.ts) / 1000);
      lines.push(`- ${ago}s ago — **${bc.type}** — ${bc.label}`);
    });
    lines.push('');
  }

  const rq = c?.reactQuery ?? [];
  if (rq.length > 0) {
    lines.push(`## React Query at capture (${rq.length} keys)`);
    rq.slice(0, 30).forEach((q) => {
      lines.push(
        `- \`${q.queryKey}\` → state=${q.state}, dataPresent=${q.dataPresent}${q.errorMessage ? `, error=${q.errorMessage.slice(0, 200)}` : ''}`,
      );
    });
    lines.push('');
  }

  if (c?.featureFlags && Object.keys(c.featureFlags).length > 0) {
    lines.push('## Feature flags');
    lines.push('```json');
    lines.push(JSON.stringify(c.featureFlags, null, 2));
    lines.push('```');
    lines.push('');
  }

  const reporterAudit = s?.reporterAuditLog ?? [];
  if (reporterAudit.length > 0) {
    lines.push(`## Reporter's recent audit log (${reporterAudit.length})`);
    reporterAudit.slice(0, 20).forEach((a) => {
      lines.push(
        `- ${a.ts} — \`${a.action}\` on ${a.targetType ?? '?'}:${a.targetId ?? '?'}${a.details ? ` — ${a.details.slice(0, 200)}` : ''}`,
      );
    });
    lines.push('');
  }

  const tenantAudit = s?.tenantAuditLog ?? [];
  if (tenantAudit.length > 0) {
    lines.push(`## Tenant's recent audit log (${tenantAudit.length})`);
    tenantAudit.slice(0, 20).forEach((a) => {
      lines.push(
        `- ${a.ts} — \`${a.action}\` (user ${a.userId?.slice(0, 8) ?? '?'}…) on ${a.targetType ?? '?'}:${a.targetId ?? '?'}`,
      );
    });
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Claude — please:');
  lines.push('');
  lines.push(
    '1. **Read the relevant code** in this repo using the breadcrumbs, network failures, and console errors above as your map.',
  );
  lines.push(
    '2. **Identify the root cause.** State your confidence (0-100) and any alternatives you ruled out.',
  );
  lines.push('3. **Write the fix** — actual code, not a sketch.');
  lines.push('4. **Verify with tsc + lint** + a Playwright probe if it\'s UI-touching.');
  lines.push(
    '5. **Commit + push** to master. Mention the bug ID in the commit body (the operator can grep for it).',
  );
  lines.push(
    `6. (Optional) **Write your analysis back** to the bug record via \`POST /api/v1/bugs/${bug.id}/manual-analysis\` with body \`{ analysis: { rootCause, filesAffected: [{filePath, reason, diff}], confidence, testPlan } }\` so the dashboard's bug-history view shows the same info.`,
  );
  lines.push('');

  return lines.join('\n');
}
