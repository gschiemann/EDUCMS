'use client';

/**
 * upload-accept.ts — the dashboard's half of "what an upload may be"
 * (2026-10-05). Every upload entry point reads THIS, and this reads the one
 * table the API reads too (`@cms/api-types` upload-formats.ts), so the same file
 * gets the same answer everywhere: the Media Library, the playlist "Add media"
 * dialog, the template builder's pickers and drop targets, the asset picker,
 * sponsor logos — and the two alert-content editors, which take less (below).
 *
 * Until 2026-10-05 there were seven lists and they disagreed: the library's
 * `accept` string and pre-check, the asset picker's (with AVIF the server
 * refused), the template-builder picker's (with SVG and AVIF the server
 * refused), "image/*" elsewhere — and the playlist dialog had none. Four
 * different sentences refused a `.mov`. Now a MOV, AVI, MKV, WMV, MPG, 3GP or
 * MPEG-TS video is accepted and converted to MP4 by the server, and a HEIC photo
 * is converted to JPEG before the asset exists.
 *
 * Where a path takes less (see the table's header): the lockdown / evacuate
 * content editor posts to /assets/upload, whose content goes straight into a
 * protected playlist the transcode never converts — it takes HEIC (converted
 * before it is stored) but not a video that is converted after upload; a
 * screen's own alert media (/assets/emergency-upload) takes screen-ready formats
 * only. Both say so in plain words and point at the Media Library.
 */
import { useTranslations } from 'next-intl';
import {
  formatAllowedOn,
  normaliseDeclaredType,
  resolveUploadFormat,
  uploadAcceptAttribute,
  uploadFormatCopyParams,
  uploadFormatLabels,
  type UploadFormat,
  type UploadKind,
  type UploadPath,
} from '@cms/api-types';

export type { UploadKind, UploadPath } from '@cms/api-types';

/** `accept` for a picker that uploads into the Media Library, optionally narrowed to some kinds. */
export function libraryAccept(kinds?: readonly UploadKind[]): string {
  return uploadAcceptAttribute('direct', kinds);
}

/** Every format the Media Library takes. */
export const LIBRARY_ACCEPT = libraryAccept();
/** iOS maps this generic type to public.data, which opens Files directly
 * instead of preparing every Photos selection before returning a FileList.
 * This is a picker hint ONLY: uploadProblemFor and server validation still
 * enforce the shared format table. Other platforms keep the normal hint. */
export const IOS_FILES_ACCEPT = 'application/octet-stream';
export function isIOSFilePicker(browser: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return !!browser && (/iPad|iPhone|iPod/.test(browser.userAgent) || (browser.platform === 'MacIntel' && browser.maxTouchPoints > 1));
}
/** Pictures only (HEIC included — it is converted to JPEG). */
export const LIBRARY_IMAGE_ACCEPT = libraryAccept(['image']);
/** The lockdown / evacuate content editor (POST /assets/upload). */
export const ALERT_CONTENT_ACCEPT = uploadAcceptAttribute('multipart');
/** A screen's own alert media (POST /assets/emergency-upload). */
export const ALERT_MEDIA_ACCEPT = uploadAcceptAttribute('emergency');

interface FileLike {
  name?: string | null;
  type?: string | null;
}

/** The format a file is taken as (null = nothing in the table). */
export function uploadFormatOf(file: FileLike): UploadFormat | null {
  return resolveUploadFormat(file.name, file.type).format;
}

/** A picture the Media Library takes — by its type OR its name (a HEIC on Windows often has no type). */
export function isLibraryImageFile(file: FileLike): boolean {
  return uploadFormatOf(file)?.kind === 'image';
}

/** A video the server converts AFTER upload (MOV, AVI, MKV, …): its URL changes when the MP4 is swapped in. */
export function isConvertedAfterUpload(file: FileLike): boolean {
  return uploadFormatOf(file)?.handling === 'convert-after-upload';
}

export type UploadProblem =
  /** SVG: an SVG can carry hidden scripts; logos have their own safe path. */
  | { code: 'svg' }
  /** Nothing in the table. */
  | { code: 'unsupported' }
  /** A format this picker does not take (a video into a picture picker). */
  | { code: 'wrong-kind'; kinds: readonly UploadKind[] }
  /** A video converted after upload, on the alert-content editor. */
  | { code: 'convert-in-library'; label: string }
  /** Anything not screen-ready, on a screen's own alert media. */
  | { code: 'not-alert-media'; label: string };

/**
 * Why `file` cannot be uploaded HERE, before any network call — null when it
 * can. The same rule the server applies (the size is checked separately).
 */
export function uploadProblemFor(
  file: FileLike,
  opts: { path?: UploadPath; kinds?: readonly UploadKind[] } = {},
): UploadProblem | null {
  const path = opts.path ?? 'direct';
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.svg') || normaliseDeclaredType(file.type) === 'image/svg+xml') return { code: 'svg' };
  const format = uploadFormatOf(file);
  if (!format) return { code: 'unsupported' };
  if (opts.kinds && !opts.kinds.includes(format.kind)) return { code: 'wrong-kind', kinds: opts.kinds };
  if (!formatAllowedOn(format, path)) {
    return path === 'multipart'
      ? { code: 'convert-in-library', label: format.label }
      : { code: 'not-alert-media', label: format.label };
  }
  return null;
}

/** The "what can I upload" lists for the copy: "JPG, PNG, …" per kind. */
export function uploadFormatsCopy(path: UploadPath = 'direct'): { images: string; videos: string; audio: string } {
  return uploadFormatCopyParams(path);
}

/** "JPG, PNG, WebP, … HEIC, MP4, …" — every format of these kinds on this path. */
export function formatsForKinds(path: UploadPath, kinds: readonly UploadKind[]): string {
  return kinds
    .map((k) => uploadFormatLabels(path, k))
    .filter(Boolean)
    .join(', ');
}

/** The translated words for an `uploadProblemFor` answer. */
export function useUploadProblemText(): (problem: UploadProblem, file: FileLike) => string {
  const t = useTranslations('uploadFormats');
  return (problem, file) => {
    const name = String(file.name || '') || t('thisFile');
    switch (problem.code) {
      case 'svg':
        return t('svg');
      case 'unsupported':
        return t('unsupported', { name, ...uploadFormatsCopy('direct') });
      case 'wrong-kind':
        return t('wrongKind', { name, formats: formatsForKinds('direct', problem.kinds) });
      case 'convert-in-library':
        return t('convertInLibrary', { name, format: problem.label });
      case 'not-alert-media':
        return t('notAlertMedia', {
          name,
          formats: formatsForKinds('emergency', ['image', 'video', 'audio', 'pdf']),
        });
    }
  };
}
