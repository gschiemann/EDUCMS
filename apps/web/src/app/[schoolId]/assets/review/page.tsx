/**
 * /[schoolId]/assets/review — content reviewer inbox.
 *
 * Admin-only page surfacing every asset in PENDING_APPROVAL status.
 * Reviewer can Approve (promotes to PUBLISHED, notifies uploader) or
 * Reject (archives + notifies with optional reason). The list
 * auto-refreshes every 30s so new uploads appear without refresh.
 */
'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Check, X, Clock, ShieldCheck, Loader2, FileText, Video, Music, ImageIcon, AlertCircle } from 'lucide-react';
import { usePendingAssets, useApproveAsset, useRejectAsset } from '@/hooks/use-api';
import { useAppStore } from '@/lib/store';
import { RoleGate } from '@/components/RoleGate';
import { appConfirm } from '@/components/ui/app-dialog';

function typeIcon(mime: string | undefined) {
  if (!mime) return FileText;
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime.startsWith('video/')) return Video;
  if (mime.startsWith('audio/')) return Music;
  return FileText;
}

function fmtBytes(n: number | undefined) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function ReviewQueuePage() {
  const user = useAppStore((s) => s.user);
  const { data: pending, isLoading } = usePendingAssets();
  const approve = useApproveAsset();
  const reject = useRejectAsset();
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    setBusyId(id);
    try {
      await approve.mutateAsync(id);
    } finally { setBusyId(null); }
  };
  const handleReject = async (id: string, name: string) => {
    const reason = await appConfirm({
      title: `Reject "${name}"?`,
      message: 'Reviewer rejection archives the asset — it can\'t be scheduled. Optional reason will be sent to the uploader.',
      tone: 'warn',
      confirmLabel: 'Reject',
      cancelLabel: 'Cancel',
      textInput: { label: 'Reason (optional)', placeholder: 'e.g. wrong size, off-brand colors…', required: false } as any,
    } as any);
    if (!reason && reason !== '') return;
    setBusyId(id);
    try {
      await reject.mutateAsync({ id, reason: typeof reason === 'string' ? reason : '' });
    } finally { setBusyId(null); }
  };

  const rows = pending || [];
  const grouped = useMemo(() => {
    const by: Record<string, any[]> = {};
    for (const a of rows) {
      const who = a.uploadedBy?.email || 'unknown';
      (by[who] ||= []).push(a);
    }
    return by;
  }, [rows]);

  return (
    <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
      <div className="max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
              <ShieldCheck className="w-7 h-7 text-indigo-500" /> Review queue
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Approve or reject contributor uploads before they can be scheduled onto screens.
            </p>
          </div>
          {pending && pending.length > 0 && (
            <div className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> {pending.length} pending
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading queue…
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <ShieldCheck className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-slate-800">All clear ✓</h2>
            <p className="text-sm text-slate-500 mt-1">
              No assets awaiting review. Contributors\u2019 new uploads will show up here automatically.
            </p>
          </div>
        ) : (
          Object.entries(grouped).map(([who, items]) => (
            <div key={who} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-3 border-b border-slate-100 flex justify-between items-center">
                <div className="text-sm font-bold text-slate-700">{who}</div>
                <div className="text-xs text-slate-400">{items.length} asset{items.length === 1 ? '' : 's'}</div>
              </div>
              <ul className="divide-y divide-slate-100">
                {items.map((a: any) => {
                  const Icon = typeIcon(a.mimeType);
                  const isImage = a.mimeType?.startsWith('image/');
                  const isBusy = busyId === a.id;
                  return (
                    <li key={a.id} className="p-4 flex items-start gap-4">
                      <div className="flex-shrink-0 w-20 h-20 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center overflow-hidden">
                        {isImage && a.fileUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.fileUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Icon className="w-7 h-7 text-slate-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-800 truncate">
                          {a.originalName || a.fileUrl?.split('/').pop() || 'Untitled'}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-3">
                          <span>{a.mimeType}</span>
                          <span>{fmtBytes(a.fileSize)}</span>
                          <span>Uploaded {new Date(a.createdAt).toLocaleString()}</span>
                          {a.folder?.name && <span>in <strong>{a.folder.name}</strong></span>}
                        </div>
                        {a.fileUrl && (
                          <a
                            href={a.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] font-semibold text-indigo-600 hover:underline mt-1 inline-block"
                          >
                            Preview in new tab →
                          </a>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleApprove(a.id)}
                          disabled={isBusy}
                          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-1.5"
                        >
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(a.id, a.originalName || 'this asset')}
                          disabled={isBusy}
                          className="px-3 py-2 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 text-rose-700 text-xs font-bold rounded-lg border border-rose-200 flex items-center gap-1.5"
                        >
                          <X className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </RoleGate>
  );
}
