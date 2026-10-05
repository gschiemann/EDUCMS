/**
 * Cross-origin links ignore the anchor's download attribute. Ask the file
 * server for Content-Disposition: attachment, without buffering large videos
 * in browser memory. Preview and playback URLs remain unchanged.
 * https://supabase.com/docs/guides/storage/serving/downloads
 */
import { uploadExtension, uploadFormatForType } from '@cms/api-types';

/** Why a file cannot be downloaded; the page translates the code (`assetsLib.downloadErrors.*`). */
export type AssetDownloadErrorCode = 'WEB_LINK' | 'NO_FILE' | 'UNSUPPORTED_URL' | 'EXTERNAL_HOST';
export class AssetDownloadError extends Error {
  constructor(readonly code: AssetDownloadErrorCode, message: string) { super(message); }
}

export function assetDownloadUrl(
  asset: { fileUrl?: string | null; originalName?: string | null; mimeType?: string | null },
  apiBase: string,
): { url: string; filename: string } {
  if (asset.mimeType === 'text/html') {
    throw new AssetDownloadError('WEB_LINK', 'Web links do not have a downloadable file. Use Copy asset link instead.');
  }
  if (!asset.fileUrl) throw new AssetDownloadError('NO_FILE', 'This asset has no file to download.');
  const api = new URL(apiBase);
  const url = new URL(asset.fileUrl, api);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AssetDownloadError('UNSUPPORTED_URL', 'This asset does not have a supported download URL.');
  }
  const storageObject = url.hostname.endsWith('.supabase.co')
    && /^\/storage\/v1\/object\/(public|sign)\/assets\/.+/.test(url.pathname);
  const localUpload = url.origin === api.origin
    && /^\/api\/v1\/assets\/file\/[^/]+$/.test(url.pathname);
  if (!storageObject && !localUpload) {
    throw new AssetDownloadError('EXTERNAL_HOST', 'This file is hosted outside the media library. Use Copy asset link instead.');
  }
  const filename = nameForStoredType(
    (asset.originalName || decodeURIComponent(url.pathname.split('/').pop() || 'asset'))
      .replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim() || 'asset',
    asset.mimeType,
  );
  url.searchParams.set('download', filename);
  return { url: url.href, filename };
}

/**
 * The download name, with an extension that agrees with what is STORED
 * (2026-10-05). An iPhone photo uploaded as `IMG_0042.HEIC` is stored as a JPEG
 * and a `clip.MOV` becomes an MP4 once converted — saved under the original name,
 * a JPEG called .HEIC or an MP4 called .MOV is a file that some computers refuse
 * to open. The name the operator gave is kept; only a mismatched extension is
 * swapped for the stored type's (shared upload-formats table). A type the table
 * does not know, or an extension that already fits, is left exactly as it was.
 */
export function nameForStoredType(name: string, mimeType: string | null | undefined): string {
  const format = uploadFormatForType(mimeType);
  if (!format) return name;
  const ext = uploadExtension(name);
  if (format.extensions.includes(ext)) return name;
  // .mp4 and .m4v are the same container; an M4V stored as video/mp4 keeps its name.
  if (MP4_FAMILY.has(format.mimeType) && MP4_FAMILY_EXTS.has(ext)) return name;
  return `${ext ? name.slice(0, name.length - ext.length) : name}${format.extensions[0]}`;
}

const MP4_FAMILY = new Set(['video/mp4', 'video/x-m4v']);
const MP4_FAMILY_EXTS = new Set(['.mp4', '.m4v']);
