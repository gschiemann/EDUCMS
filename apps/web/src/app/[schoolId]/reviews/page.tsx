"use client";

/**
 * Reviews — admin queue for the submit-for-review workflow (Sprint 1.5).
 *
 * Shows PENDING submissions in a left rail. Click one → drills into a
 * full-detail view with embedded asset thumbnails, playlist contents,
 * and schedule targets so the reviewer can decide without chasing 6
 * separate API calls. Approve / Reject each take an optional note that
 * surfaces back to the contributor on their dashboard.
 *
 * Visible only to SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN — sidebar
 * link gating is in DashboardLayout.
 */

import { useState } from 'react';
import Link from 'next/link';
import { use } from 'react';
import { Check, X, Inbox, ArrowLeft, Loader2 } from 'lucide-react';
import { useSubmissions, useSubmission, useDecideSubmission, type SubmissionRow } from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';

export default function ReviewsPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = use(params);
  const role = useUIStore((s) => s.user?.role);
  const isAdmin = role === 'SUPER_ADMIN' || role === 'DISTRICT_ADMIN' || role === 'SCHOOL_ADMIN';

  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: submissions, isLoading } = useSubmissions({ status: statusFilter });

  if (!isAdmin) {
    return (
      <div className="p-12 text-center">
        <p className="text-slate-500 text-sm">Reviewer access only. Contributors can see their own submissions on the dashboard.</p>
        <Link href={`/${schoolId}/dashboard`} className="text-indigo-600 text-sm hover:underline mt-2 inline-block">← Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Left rail — submission list */}
      <div className="w-[360px] border-r border-slate-200 bg-white flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Inbox className="w-5 h-5 text-indigo-500" />
            Reviews
          </h1>
          <p className="text-xs text-slate-500 mt-1">Review submissions from contributors before they go live.</p>
          <div className="mt-3 inline-flex rounded-lg border border-slate-200 overflow-hidden">
            {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setStatusFilter(s); setSelectedId(null); }}
                className={`px-3 py-1.5 text-[11px] font-bold transition-colors ${
                  statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && <div className="p-6 text-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline-block" /></div>}
          {!isLoading && (submissions || []).length === 0 && (
            <div className="p-6 text-center text-xs text-slate-400">
              No {statusFilter.toLowerCase()} submissions.
            </div>
          )}
          {(submissions || []).map((s) => (
            <SubmissionRowCard
              key={s.id}
              submission={s}
              selected={selectedId === s.id}
              onClick={() => setSelectedId(s.id)}
            />
          ))}
        </div>
      </div>

      {/* Right pane — drilldown */}
      <div className="flex-1 overflow-y-auto bg-slate-50/40">
        {selectedId ? (
          <ReviewDetail id={selectedId} onBack={() => setSelectedId(null)} statusFilter={statusFilter} />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm">
            <p>Select a submission on the left to review it.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SubmissionRowCard({ submission, selected, onClick }: { submission: SubmissionRow; selected: boolean; onClick: () => void }) {
  const itemCount = submission.assetIds.length + submission.playlistIds.length + submission.scheduleIds.length;
  const submitterEmail = submission.submittedBy?.email || 'unknown';
  const date = new Date(submission.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-3 border-b border-slate-100 transition-colors ${
        selected ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : 'hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-700 truncate">{submitterEmail}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">{date} · {itemCount} item{itemCount === 1 ? '' : 's'}</div>
          {submission.note && (
            <div className="text-[11px] text-slate-500 mt-1 line-clamp-2">{submission.note}</div>
          )}
        </div>
        <StatusPill status={submission.status} />
      </div>
    </button>
  );
}

function StatusPill({ status }: { status: SubmissionRow['status'] }) {
  const cls = status === 'PENDING'
    ? 'bg-amber-100 text-amber-700'
    : status === 'APPROVED'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-rose-100 text-rose-700';
  return <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${cls}`}>{status}</span>;
}

function ReviewDetail({ id, onBack, statusFilter }: { id: string; onBack: () => void; statusFilter: string }) {
  const { data: submission, isLoading } = useSubmission(id);
  const decide = useDecideSubmission();
  const [note, setNote] = useState('');

  if (isLoading || !submission) {
    return <div className="p-12 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin inline-block" /></div>;
  }

  const itemCount = submission.assetIds.length + submission.playlistIds.length + submission.scheduleIds.length;
  const submitter = submission.submittedBy?.email || 'unknown';
  const isPending = submission.status === 'PENDING';

  const handleDecide = async (decision: 'approve' | 'reject') => {
    try {
      await decide.mutateAsync({ id, decision, reviewerNote: note.trim() || undefined });
      onBack();
    } catch (err: any) {
      alert(`Could not ${decision}: ${err.message || 'unknown error'}`);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <button onClick={onBack} className="text-xs text-slate-500 hover:text-slate-700 mb-4 inline-flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to list
      </button>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Submission from {submitter}</h2>
          <p className="text-xs text-slate-500 mt-1">{itemCount} item{itemCount === 1 ? '' : 's'} · submitted {new Date(submission.createdAt).toLocaleString()}</p>
        </div>
        <StatusPill status={submission.status} />
      </div>

      {submission.note && (
        <div className="mb-4 p-3 bg-white rounded-lg border border-slate-200">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Submitter note</div>
          <p className="text-sm text-slate-700">{submission.note}</p>
        </div>
      )}

      {submission.reviewerNote && !isPending && (
        <div className="mb-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
          <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">Reviewer note</div>
          <p className="text-sm text-amber-800">{submission.reviewerNote}</p>
        </div>
      )}

      {submission.assets.length > 0 && (
        <Section title={`Assets (${submission.assets.length})`}>
          <div className="grid grid-cols-3 gap-3">
            {submission.assets.map((a: any) => (
              <div key={a.id} className="bg-white rounded-lg border border-slate-200 p-2">
                {a.mimeType?.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.fileUrl} alt={a.originalName || ''} className="w-full h-24 object-cover rounded" />
                ) : (
                  <div className="w-full h-24 bg-slate-100 rounded flex items-center justify-center text-[10px] text-slate-500 uppercase font-bold">
                    {a.mimeType?.split('/')[0] || 'file'}
                  </div>
                )}
                <div className="text-[10px] text-slate-600 truncate mt-1">{a.originalName || a.fileUrl}</div>
                <div className="text-[9px] text-slate-400">{a.status}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {submission.playlists.length > 0 && (
        <Section title={`Playlists (${submission.playlists.length})`}>
          {submission.playlists.map((p: any) => (
            <div key={p.id} className="bg-white rounded-lg border border-slate-200 p-3 mb-2">
              <div className="text-sm font-bold text-slate-700">{p.name}</div>
              <div className="text-[10px] text-slate-400">{p.items?.length || 0} items</div>
              <ol className="mt-2 pl-4 text-xs text-slate-600 list-decimal space-y-0.5">
                {(p.items || []).slice(0, 6).map((it: any) => (
                  <li key={it.id} className="truncate">{it.asset?.originalName || it.asset?.fileUrl || '(asset)'}</li>
                ))}
                {(p.items || []).length > 6 && <li className="text-slate-400">…and {p.items.length - 6} more</li>}
              </ol>
            </div>
          ))}
        </Section>
      )}

      {submission.schedules.length > 0 && (
        <Section title={`Schedules (${submission.schedules.length})`}>
          {submission.schedules.map((s: any) => (
            <div key={s.id} className="bg-white rounded-lg border border-slate-200 p-3 mb-2 text-xs">
              <div className="font-bold text-slate-700">{s.playlist?.name || 'playlist'}</div>
              <div className="text-slate-500 mt-1">
                Target: {s.screen?.name || s.screenGroup?.name || '(unset)'} · Active: {s.isActive ? 'yes' : 'no'}
              </div>
              {s.daysOfWeek && <div className="text-slate-400 text-[10px] mt-0.5">{s.daysOfWeek} {s.timeStart && s.timeEnd ? `${s.timeStart}–${s.timeEnd}` : ''}</div>}
            </div>
          ))}
        </Section>
      )}

      {/* Decide */}
      {isPending && (
        <div className="mt-6 p-4 bg-white rounded-xl border-2 border-indigo-100 sticky bottom-4 shadow-lg">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Note to submitter (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Looks good!  /  Please retake the photo…  /  Move to staff folder first…"
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => handleDecide('approve')}
              disabled={decide.isPending}
              className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg shadow-sm flex items-center justify-center gap-2"
            >
              <Check className="w-4 h-4" /> Approve & publish
            </button>
            <button
              type="button"
              onClick={() => handleDecide('reject')}
              disabled={decide.isPending}
              className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg shadow-sm flex items-center justify-center gap-2"
            >
              <X className="w-4 h-4" /> Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </section>
  );
}
