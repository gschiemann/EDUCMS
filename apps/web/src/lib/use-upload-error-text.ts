'use client';

/**
 * The words a picker shows when a direct upload fails (2026-09-23). Server
 * refusals (a 413/415 from presign or complete-upload) already carry the
 * specific, actionable API message — "Video is too large for signage (2.5 GB).
 * Max is 2 GB…" — so those pass through; transport failures get translated
 * copy. Shared by every picker that calls `uploadAssetDirect`.
 */
import { useTranslations } from 'next-intl';
import { DirectUploadError, formatUploadCap, maxUploadBytesFor } from '@/lib/direct-upload';

function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function useUploadErrorText(): (err: unknown, file: File) => string {
  const t = useTranslations('directUpload');
  return (err, file) => {
    if (err instanceof DirectUploadError) {
      // Our API's refusal already says exactly what to do — show it as sent.
      if (err.source === 'api' && err.message) return err.message;
      if (err.code === 'aborted') return t('cancelled');
      if (err.code === 'network') return t('networkLost');
      if (err.code === 'expired') return t('expired');
      if (err.code === 'too-large') {
        return t('tooLarge', { name: file.name, size: fmtBytes(file.size), max: formatUploadCap(maxUploadBytesFor(file)) });
      }
      return t('storageRefused');
    }
    return (err as Error)?.message || t('storageRefused');
  };
}

/** A pre-flight check a picker runs before any network call. null = fine. */
export function useUploadTooLargeText(): (file: File) => string | null {
  const t = useTranslations('directUpload');
  return (file) => {
    const max = maxUploadBytesFor(file);
    return file.size > max ? t('tooLarge', { name: file.name, size: fmtBytes(file.size), max: formatUploadCap(max) }) : null;
  };
}
