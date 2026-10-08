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
function validRendition(
  meta: unknown,
  key = '1080p',
): SelectedVideoFile | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const renditions = (meta as Record<string, unknown>).renditions;
  if (
    !renditions ||
    typeof renditions !== 'object' ||
    Array.isArray(renditions)
  )
    return null;
  const rendition = (renditions as Record<string, unknown>)[key];
  if (!rendition || typeof rendition !== 'object' || Array.isArray(rendition))
    return null;
  const { url, sha256, size } = rendition as Record<string, unknown>;
  // A partially published record must never make the player's URL/hash/size disagree.
  if (
    typeof url !== 'string' ||
    !/^https:\/\//.test(url) ||
    typeof sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(sha256) ||
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size <= 0
  )
    return null;
  return { url, sha256, size };
}

/** Explicit field compatibility control; unknown screens keep normal quality selection. */
export function usesPortraitAvcCompatibility(
  screenId: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env.PLAYER_PORTRAIT_AVC_COMPAT ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .includes(screenId);
}

function portraitAvcRendition(
  meta: unknown,
  sourceHash: string | null | undefined,
): SelectedVideoFile | null {
  const selected = validRendition(meta, 'portrait-avc-compat');
  if (!selected) return null;
  const m = meta as {
    probe?: { fps?: number };
    renditions: Record<string, Record<string, unknown>>;
  };
  const standard = m.renditions['1080p'];
  const compat = m.renditions['portrait-avc-compat'];
  // Rotation changes the coded picture's axes, never its displayed pixels or fps.
  if (
    !standard ||
    typeof standard.width !== 'number' ||
    typeof standard.height !== 'number' ||
    !Number.isSafeInteger(standard.width) ||
    !Number.isSafeInteger(standard.height) ||
    standard.width <= 0 ||
    standard.height <= 0 ||
    standard.width >= standard.height ||
    compat.displayWidth !== standard.width ||
    compat.displayHeight !== standard.height ||
    compat.codedWidth !== standard.height ||
    compat.codedHeight !== standard.width ||
    compat.rotation !== 90 ||
    !sourceHash ||
    compat.sourceSha256 !== sourceHash ||
    compat.codec !== 'h264' ||
    compat.profile !== 'Constrained Baseline' ||
    compat.level !== 40 ||
    typeof m.probe?.fps !== 'number' ||
    !Number.isFinite(m.probe.fps) ||
    m.probe.fps <= 0 ||
    compat.fps !== Math.min(30, m.probe.fps)
  )
    return null;
  return selected;
}

export function selectVideoFile(
  asset: ManifestVideoAsset,
  screenResolution: string | null | undefined,
  portraitAvcCompatibility = false,
): SelectedVideoFile {
  const primary = {
    url: asset.fileUrl,
    sha256: asset.fileHash ?? null,
    size: asset.fileSize ?? null,
  };
  if (!asset.mimeType || !/^(video|image)\//i.test(asset.mimeType))
    return primary;
  const match = /^\s*(\d{2,6})\s*[x×X*]\s*(\d{2,6})\s*$/.exec(
    screenResolution ?? '',
  );
  if (
    !match ||
    Math.max(Number(match[1]), Number(match[2])) > 1920 ||
    Math.min(Number(match[1]), Number(match[2])) > 1080
  )
    return primary;
  if (portraitAvcCompatibility && asset.mimeType === 'video/mp4') {
    const compatible = portraitAvcRendition(
      asset.processingMeta,
      asset.fileHash,
    );
    if (compatible) return compatible;
  }
  return validRendition(asset.processingMeta) ?? primary;
}

// A >1080p screen gets ONLY its native file. `selectFallbackVideoFile` (the
// 1080p copy as a stand-in until the native file cached, bdb3f59a) was removed
// on 2026-09-26: a screen never plays a lower-resolution stand-in and then
// switches up — it downloads the whole native file, then plays it (Greg).
