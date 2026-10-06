'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CompletedAsset } from '@/lib/direct-upload';
import { LIBRARY_ACCEPT } from '@/lib/upload-accept';
import { useFilePicker } from '@/hooks/use-file-picker';
import { useLibraryUploads } from '@/hooks/use-library-uploads';
import { clearUploadJobs } from '@/lib/upload-job-store';

/** The same app-owned queue as the library; leaving the wizard does not
 * cancel accepted uploads. Successful files are selected while it is open. */
export function WizardMediaUpload({ folderId, folderName, onUploaded, onBusy }: {
  folderId: string | null; folderName: string;
  onUploaded: (asset: CompletedAsset) => void; onBusy: (busy: boolean) => void;
}) {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const picker = useFilePicker(input);
  const jobs = useLibraryUploads();
  const [ids, setIds] = useState<string[]>([]);
  const rows = useMemo(() => jobs.uploads.filter(item => ids.includes(item.id)), [jobs.uploads, ids]);
  const [pending, setPending] = useState<{ files: File[]; folderId: string | null; folderName: string } | null>(null);
  const reported = useRef(new Set<string>());
  const callbacks = useRef({ onUploaded, onBusy });
  callbacks.current = { onUploaded, onBusy };
  const busy = !!pending || rows.some(row => ['idle', 'uploading', 'processing'].includes(row.phase));
  useEffect(() => { callbacks.current.onBusy(busy); }, [busy]);
  useEffect(() => () => { callbacks.current.onBusy(false); }, []);
  useEffect(() => {
    for (const row of rows) if (row.asset && !reported.current.has(row.id)) {
      reported.current.add(row.id); callbacks.current.onUploaded(row.asset);
    }
  }, [rows]);

  return <div className="mb-4 rounded-xl border border-slate-200 p-3" aria-label="Upload playlist media">
    <input ref={input} type="file" multiple accept={LIBRARY_ACCEPT} className="hidden" aria-label="Choose playlist files" onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = '';
      if (files.length) setPending({ files, folderId, folderName });
    }} />
    <button type="button" disabled={!!pending} onClick={() => picker.open()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold disabled:opacity-50">
      <Upload className="h-4 w-4" aria-hidden /> {t('assetsLib.uploadFiles')}
    </button>
    {picker.ios && <>
      <button type="button" disabled={!!pending} onClick={() => picker.open('photos')} className="ml-2 min-h-11 px-3 text-sm font-semibold disabled:opacity-50">{t('assetsLib.photoLibrary')}</button>
      <p className="mt-2 text-xs text-slate-500">{t('assetsLib.iosVideoHint')}</p>
    </>}
    {pending && <div className="mt-3 space-y-2">
      <p className="break-words text-xs text-slate-600">{pending.files.map(file => file.name).join(', ')} · {pending.folderName}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white" onClick={() => {
          setIds(current => [...current, ...jobs.start(pending.files, pending.folderId)]); setPending(null);
        }}>{t('assetsLib.uploadSelected', { count: pending.files.length })}</button>
        <button type="button" className="min-h-11 px-3 text-sm font-semibold" onClick={() => setPending(null)}>{t('assetsLib.cancelUploadSelection')}</button>
      </div>
    </div>}
    {rows.length > 0 && <>
      <ul className="mt-3 space-y-2" aria-live="polite">
        {rows.map(row => <li key={row.id} className="break-words text-xs text-slate-600">
          <span className="font-semibold">{row.file.name}</span> · {row.phase === 'uploading' ? `${row.progress}%` : row.phase === 'success' ? 'Added to playlist' : row.phase === 'pending-review' ? 'Added · pending review' : row.phase === 'processing' ? 'Checking file…' : row.phase === 'error' ? row.error : 'Queued'}
          {row.canRetry && <button type="button" className="ml-2 min-h-11 font-semibold text-indigo-700" onClick={() => jobs.retry(row)}>{t('assetsLib.retryUpload')}</button>}
        </li>)}
      </ul>
      <button type="button" className="min-h-11 text-xs font-semibold" onClick={() => clearUploadJobs(ids)}>{t('assetsLib.clearFiles')}</button>
    </>}
  </div>;
}
