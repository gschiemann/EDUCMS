"use client";

import { useAssets, useApproveAsset, useRejectAsset } from '@/hooks/use-api';
import { FileImage, FileVideo, CheckCircle2, Clock, XCircle, Loader2 } from 'lucide-react';

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  PUBLISHED: { label: 'Published', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  PENDING_APPROVAL: { label: 'Pending', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
  ARCHIVED: { label: 'Archived', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

export function AssetLibrary() {
  const { data: assets, isLoading } = useAssets();
  const approveAsset = useApproveAsset();
  const rejectAsset = useRejectAsset();

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!assets || assets.length === 0) {
    return (
      <p className="text-sm text-slate-500 text-center py-6">No assets uploaded yet.</p>
    );
  }

  return (
    <div className="space-y-2 max-h-[500px] overflow-y-auto">
      {assets.map((asset: any) => {
        const status = STATUS_STYLES[asset.status] || STATUS_STYLES.ARCHIVED;
        const filename = asset.fileUrl?.split('/').pop() || 'Unknown file';
        const isVideo = asset.mimeType?.startsWith('video');
        const isImage = asset.mimeType?.startsWith('image');
        const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace('/api/v1', '');
        const thumbUrl = isImage ? (asset.fileUrl?.startsWith('http') ? asset.fileUrl : `${apiBase}${asset.fileUrl}`) : null;

        return (
          <div key={asset.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
            <div className="shrink-0 w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden flex items-center justify-center">
              {thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbUrl} alt={filename} className="w-full h-full object-cover" />
              ) : isVideo ? (
                <FileVideo className="w-5 h-5 text-indigo-500 m-2" />
              ) : (
                <FileImage className="w-5 h-5 text-sky-500 m-2" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{filename}</p>
              <p className="text-xs text-slate-500">
                {asset.mimeType} • {asset.uploadedBy?.email || 'Unknown'}
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${status.className}`}>
                {status.label}
              </span>
              {asset.status === 'PENDING_APPROVAL' && (
                <div className="flex gap-1">
                  <button
                    onClick={() => approveAsset.mutate(asset.id)}
                    className="p-1 text-emerald-500 hover:text-emerald-700 transition-colors"
                    title="Approve"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => rejectAsset.mutate(asset.id)}
                    className="p-1 text-red-400 hover:text-red-600 transition-colors"
                    title="Reject"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
