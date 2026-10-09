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

/** A separate, exact-screen field trial; absent by default. */
export function usesNoBFrameCompatibility(
  screenId: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    !!screenId &&
    (env.PLAYER_VIDEO_NO_B ?? '')
      .split(',')
      .some((id) => id.trim() === screenId)
  );
}

function noBFrameRendition(
  meta: unknown,
  sourceHash: string | null | undefined,
): SelectedVideoFile | null {
  const selected = validRendition(meta, 'avc-no-b');
  if (!selected) return null;
  const m = meta as {
    probe?: { fps?: number };
    renditions: Record<string, Record<string, unknown>>;
  };
  const standard = m.renditions['1080p'];
  const candidate = m.renditions['avc-no-b'];
  if (
    !standard ||
    !validRendition(meta) ||
    !sourceHash ||
    candidate.sourceSha256 !== sourceHash ||
    candidate.standardSha256 !== standard.sha256 ||
    !Number.isSafeInteger(standard.width) ||
    !Number.isSafeInteger(standard.height) ||
    Number(standard.width) <= 0 ||
    Number(standard.height) <= 0 ||
    candidate.width !== standard.width ||
    candidate.height !== standard.height ||
    candidate.rotation !== 0 ||
    candidate.codec !== 'h264' ||
    candidate.profile !== 'High' ||
    candidate.level !== 41 ||
    candidate.bFrames !== 0 ||
    candidate.referenceFrames !== 1 ||
    typeof m.probe?.fps !== 'number' ||
    !Number.isFinite(m.probe.fps) ||
    m.probe.fps <= 0 ||
    candidate.fps !== Math.min(30, m.probe.fps) ||
    typeof candidate.bitrate !== 'number' ||
    !Number.isFinite(candidate.bitrate) ||
    candidate.bitrate <= 0 ||
    typeof standard.bitrate !== 'number' ||
    !Number.isFinite(standard.bitrate) ||
    candidate.bitrate > standard.bitrate
  )
    return null;
  // Field copies must carry the original comparison, including difficult motion
  // and fine text. An average alone can conceal a visibly worse interval.
  const quality = candidate.quality as Record<string, unknown> | undefined;
  if (
    !quality ||
    quality.version !== 1 ||
    quality.frames !== 3000 ||
    quality.visualChecked !== true
  )
    return null;
  for (const region of ['full', 'text']) {
    const scores = quality[region] as Record<string, unknown> | undefined;
    if (!scores) return null;
    for (const [metric, tolerance] of [
      ['avg', 0.0001],
      ['worst1percent', 0.001],
      ['worst1second', 0.001],
    ] as const) {
      const pair = scores[metric] as
        | { standard?: number; candidate?: number }
        | undefined;
      if (
        !pair ||
        typeof pair.standard !== 'number' ||
        typeof pair.candidate !== 'number' ||
        !Number.isFinite(pair.standard) ||
        !Number.isFinite(pair.candidate) ||
        pair.standard < 0 ||
        pair.standard > 1 ||
        pair.candidate < 0 ||
        pair.candidate > 1 ||
        pair.standard - pair.candidate > tolerance
      )
        return null;
    }
  }
  return selected;
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
  noBFrameCompatibility = false,
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
  if (noBFrameCompatibility && asset.mimeType === 'video/mp4') {
    const compatible = noBFrameRendition(asset.processingMeta, asset.fileHash);
    if (compatible) return compatible;
  }
  return validRendition(asset.processingMeta) ?? primary;
}

// A >1080p screen gets ONLY its native file. `selectFallbackVideoFile` (the
// 1080p copy as a stand-in until the native file cached, bdb3f59a) was removed
// on 2026-09-26: a screen never plays a lower-resolution stand-in and then
// switches up — it downloads the whole native file, then plays it (Greg).
