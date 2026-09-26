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

/** The 1080p copy, only when every integrity field describes it. */
function validRendition(meta: unknown): SelectedVideoFile | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const renditions = (meta as Record<string, unknown>).renditions;
  if (!renditions || typeof renditions !== 'object' || Array.isArray(renditions)) return null;
  const rendition = (renditions as Record<string, unknown>)['1080p'];
  if (!rendition || typeof rendition !== 'object' || Array.isArray(rendition)) return null;
  const { url, sha256, size } = rendition as Record<string, unknown>;
  // A partially published record must never make the player's URL/hash/size disagree.
  if (typeof url !== 'string' || !/^https:\/\//.test(url) ||
      typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256) ||
      typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) return null;
  return { url, sha256, size };
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
  return validRendition(asset.processingMeta) ?? primary;
}

/**
 * The 1080p copy a screen that was given the NATIVE video may play until that
 * file is in its cache (2026-09-26). A 4K clip streamed from origin is what
 * stuttered on the field 4K screen while its cache was still empty; the
 * copy streams fine and caches in seconds, and the player moves up to the
 * native file at the next mount once it has landed. Video only — an image
 * needs no such bridge — and never the file that was already selected.
 */
export function selectFallbackVideoFile(
  asset: ManifestVideoAsset,
  selected: SelectedVideoFile,
): SelectedVideoFile | null {
  if (!asset.mimeType || !/^video\//i.test(asset.mimeType)) return null;
  const rendition = validRendition(asset.processingMeta);
  if (!rendition || rendition.url === selected.url) return null;
  return rendition;
}
