/** A manifest may select a smaller file only when all integrity fields describe it. */
export interface ManifestVideoAsset {
  fileUrl: string;
  fileHash?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  processingMeta?: unknown;
}

export interface SelectedVideoFile {
  url: string;
  sha256: string | null;
  size: number | null;
}

export function selectVideoFile(
  asset: ManifestVideoAsset,
  screenResolution: string | null | undefined,
): SelectedVideoFile {
  const primary = {
    url: asset.fileUrl,
    sha256: asset.fileHash ?? null,
    size: asset.fileSize ?? null,
  };
  if (!asset.mimeType || !/^(video|image)\//i.test(asset.mimeType)) return primary;
  const match = /^\s*(\d{2,6})\s*[x×X*]\s*(\d{2,6})\s*$/.exec(
    screenResolution ?? '',
  );
  if (!match || Math.max(Number(match[1]), Number(match[2])) > 1920 ||
      Math.min(Number(match[1]), Number(match[2])) > 1080) return primary;
  const meta = asset.processingMeta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return primary;
  const rendition = (meta as Record<string, any>).renditions?.['1080p'];
  if (!rendition || typeof rendition !== 'object') return primary;
  const { url, sha256, size } = rendition;
  // A partially published record must never make the player's URL/hash/size disagree.
  if (typeof url !== 'string' || !/^https:\/\//.test(url) ||
      typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256) ||
      !Number.isSafeInteger(size) || size <= 0) return primary;
  return { url, sha256, size };
}
