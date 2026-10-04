/**
 * Cross-origin links ignore the anchor's download attribute. Ask the file
 * server for Content-Disposition: attachment, without buffering large videos
 * in browser memory. Preview and playback URLs remain unchanged.
 * https://supabase.com/docs/guides/storage/serving/downloads
 */
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
  const filename = (asset.originalName || decodeURIComponent(url.pathname.split('/').pop() || 'asset'))
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim() || 'asset';
  url.searchParams.set('download', filename);
  return { url: url.href, filename };
}
