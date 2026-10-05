'use client';

/**
 * The words a picker shows when a direct upload fails (2026-09-23). Server
 * refusals (a 413/415 from presign or complete-upload) already carry the
 * specific, actionable API message — "File is too large. Max size is 500 MB." —
 * so those pass through; transport failures get translated copy. Shared by
 * every picker that calls `uploadAssetDirect`.
 *
 * 2026-10-05 — complete-upload now reads the bytes and refuses a file that is
 * not what its name says, or that a screen cannot play (a truncated video, text
 * named .jpg, a PDF cut short …: apps/api/src/assets/upload-content-verdict.ts).
 * Each refusal has a stable code, translated here; the server's English sentence
 * is the same words and stays the fallback.
 */
import { useTranslations } from 'next-intl';
import {
  DirectUploadError,
  formatUploadCap,
  maxUploadBytesFor,
  refuseBeforeUploadAboveBytes,
} from '@/lib/direct-upload';
import { STORAGE_QUOTA_EXCEEDED, formatStorageBytes, storageQuotaNumbers } from '@/lib/storage-bytes';
import { uploadFormatsCopy } from '@/lib/upload-accept';

/**
 * The upload content check's refusal codes → their `directUpload.*` words.
 * MUST list every code in UPLOAD_REFUSALS (apps/api/src/assets/upload-content-
 * verdict.ts) — use-upload-error-text.test.tsx reads that file and fails on a
 * code that has no words here.
 */
export const CONTENT_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  ASSET_FILE_EMPTY: 'fileEmpty',
  ASSET_IMAGE_UNREADABLE: 'imageUnreadable',
  // 2026-10-05 — a HEIC is CONVERTED to JPEG at upload; these two are the
  // conversion failing (the file) and not running just now (try again).
  ASSET_IMAGE_HEIC: 'imageHeic',
  ASSET_IMAGE_HEIC_UNAVAILABLE: 'imageHeicUnavailable',
  ASSET_VIDEO_UNPLAYABLE: 'videoUnplayable',
  ASSET_VIDEO_NO_PICTURE: 'videoNoPicture',
  ASSET_VIDEO_IS_PICTURE: 'videoIsPicture',
  ASSET_AUDIO_UNPLAYABLE: 'audioUnplayable',
  ASSET_PDF_NOT_PDF: 'pdfNotPdf',
  ASSET_PDF_INCOMPLETE: 'pdfIncomplete',
};

function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function useUploadErrorText(): (err: unknown, file: File) => string {
  const t = useTranslations('directUpload');
  const tf = useTranslations('uploadFormats');
  return (err, file) => {
    if (err instanceof DirectUploadError) {
      // 2026-09-24 — the organisation's storage allowance is full (413
      // STORAGE_QUOTA_EXCEEDED from presign, multipart or complete-upload).
      // The body carries the numbers, so this one refusal is translated; a
      // body without them falls through to the server's own sentence.
      if (err.source === 'api' && err.apiCode === STORAGE_QUOTA_EXCEEDED) {
        const n = storageQuotaNumbers(err.apiBody);
        if (n) {
          return t('storageFull', {
            need: formatStorageBytes(n.neededBytes),
            left: formatStorageBytes(Math.max(0, n.includedBytes - n.usedBytes)),
            total: formatStorageBytes(n.includedBytes),
          });
        }
      }
      // 2026-10-05 — the file is not what its name says, or a screen cannot play it.
      if (err.source === 'api' && err.apiCode && CONTENT_REFUSAL_KEYS[err.apiCode]) {
        return t(CONTENT_REFUSAL_KEYS[err.apiCode]);
      }
      // 2026-10-05 — "this kind of file can't be uploaded": the same words, and the
      // same format lists (the shared upload-formats table), as the page's own
      // pre-check — in the operator's language, not the server's English.
      if (err.source === 'api' && err.apiCode === 'ASSET_FILE_TYPE_UNSUPPORTED') {
        return tf('unsupported', { name: file.name || tf('thisFile'), ...uploadFormatsCopy('direct') });
      }
      if (err.source === 'api' && err.apiCode === 'ASSET_SVG_NOT_SUPPORTED') return tf('svg');
      // Our API's refusal already says exactly what to do — show it as sent.
      if (err.source === 'api' && err.message) return err.message;
      if (err.code === 'empty') return t('fileEmpty');
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

/**
 * A pre-flight check a picker runs before any network call. null = fine.
 * Refuses an empty file, and a file over the limit the server has stated (a video
 * the server has not been asked about yet goes to presign, which answers before a
 * byte moves — see `refuseBeforeUploadAboveBytes`).
 */
export function useUploadTooLargeText(): (file: File) => string | null {
  const t = useTranslations('directUpload');
  return (file) => {
    if (file.size === 0) return t('fileEmpty');
    return file.size > refuseBeforeUploadAboveBytes(file)
      ? t('tooLarge', { name: file.name, size: fmtBytes(file.size), max: formatUploadCap(maxUploadBytesFor(file)) })
      : null;
  };
}
