'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { gradeVideoEncode, type VideoEncodeTarget } from '@cms/api-types';
import { useUIStore } from '@/store/ui-store';
import { useUploadJobStore, updateUploadItems, enqueueUploadJob, clearUploadJobs, type UploadItem } from '@/lib/upload-job-store';
import { DirectUploadError, uploadAssetDirect, refuseBeforeUploadAboveBytes, maxUploadBytesFor, formatUploadCap } from '@/lib/direct-upload';
import { uploadProblemFor, useUploadProblemText } from '@/lib/upload-accept';
import { useUploadErrorText } from '@/lib/use-upload-error-text';
import { formatMediaBytes } from '@/lib/media-bytes';
import { inspectVideoFile } from '@/lib/mp4-inspect';
import { isVideoMime } from '@/lib/video-encode-copy';

/** Both library and wizard own the selection UI; the app owns accepted jobs.
 * No effect cleans these jobs up when a page or wizard unmounts. */
export function useLibraryUploads(target?: VideoEncodeTarget) {
  const userId = useUIStore(state => state.user?.id);
  const tenantId = useUIStore(state => state.user?.tenantId);
  const all = useUploadJobStore(state => state.items);
  const uploads = useMemo(() => all.filter(item => item.ownerUserId === userId && item.ownerTenantId === tenantId), [all, userId, tenantId]);
  const t = useTranslations();
  const problemText = useUploadProblemText();
  const errorText = useUploadErrorText();
  const qc = useQueryClient();
  const setUploads = (update: (items: UploadItem[]) => UploadItem[]) => updateUploadItems(items => [
    ...items.filter(item => item.ownerUserId !== userId || item.ownerTenantId !== tenantId),
    ...update(items.filter(item => item.ownerUserId === userId && item.ownerTenantId === tenantId)),
  ]);
  const patch = (id: string, update: Partial<UploadItem>) => setUploads(items => items.map(item => item.id === id ? { ...item, ...update } : item));
  const run = (item: UploadItem) => enqueueUploadJob(item.id, async signal => {
    try {
      patch(item.id, { phase: 'uploading', progress: 0, note: undefined, error: undefined, canRetry: false });
      const asset = await uploadAssetDirect(item.file, {
        folderId: item.folderId, signal,
        onProgress: ({ loaded, fraction }) => patch(item.id, { sent: loaded, progress: Math.min(96, Math.round(fraction * 96)) }),
        onPhase: phase => {
          if (phase === 'finalizing') patch(item.id, { phase: 'processing', progress: 98, note: undefined });
          else if (phase === 'reconnecting') patch(item.id, { note: t('directUpload.resuming') });
          else if (phase === 'uploading') patch(item.id, { note: undefined });
        },
      });
      if (signal.aborted) return;
      patch(item.id, { asset, phase: asset.status === 'PENDING_APPROVAL' ? 'pending-review' : 'success', progress: 100 });
      void qc.invalidateQueries({ queryKey: ['assets'] });
    } catch (error) {
      if (signal.aborted) return;
      patch(item.id, { phase: 'error', note: undefined, error: errorText(error, item.file),
        canRetry: error instanceof DirectUploadError && error.source === 'client' && ['network', 'storage', 'expired'].includes(error.code) });
    }
  });
  const start = (files: File[], folderId: string | null): string[] => {
    if (!userId || !tenantId) return [];
    const items: UploadItem[] = files.map((file, index) => {
      const item: UploadItem = { id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`, ownerUserId: userId, ownerTenantId: tenantId, file, folderId, phase: 'idle', progress: 0 };
      const problem = uploadProblemFor(file);
      if (problem) { item.phase = 'error'; item.error = problemText(problem, file); }
      else if (!file.size) { item.phase = 'error'; item.error = t('directUpload.fileEmpty'); }
      else if (file.size > refuseBeforeUploadAboveBytes(file)) {
        item.phase = 'error'; item.error = t('assetsLib.fileTooLargeFor', { max: formatUploadCap(maxUploadBytesFor(file)), size: formatMediaBytes(file.size) });
      }
      if (isVideoMime(file.type)) item.encode = { status: 'checking', verdict: { grade: 'unknown', reasons: [] }, facts: null };
      return item;
    });
    setUploads(previous => [...items, ...previous]);
    for (const item of items) {
      if (item.encode) void inspectVideoFile(item.file).then(inspected => {
        const facts = inspected.container ? inspected.facts : null;
        const verdict = gradeVideoEncode(facts, target);
        patch(item.id, { encode: { status: facts ? verdict.grade : 'unknown', verdict, facts } });
      }).catch(() => patch(item.id, { encode: { status: 'unknown', verdict: { grade: 'unknown', reasons: [] }, facts: null } }));
      if (item.phase === 'idle') run(item);
    }
    return items.map(item => item.id);
  };
  const retry = (item: UploadItem) => {
    if (!item.canRetry) return;
    patch(item.id, { phase: 'idle', progress: 0, canRetry: false, error: undefined });
    run(item);
  };
  return { uploads, setUploads, start, retry, clear: () => clearUploadJobs(uploads.map(item => item.id)) };
}
