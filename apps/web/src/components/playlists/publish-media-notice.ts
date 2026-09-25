/** The publish sheet explains decoder-specific media work before scheduling. */
type MediaAsset = { mimeType?: string | null; processingMeta?: unknown };
type Target = { resolution?: string | null };

export function publicationOptimizationNotice(assets: MediaAsset[], targets: readonly Target[]): string | null {
  const lowerResolution = targets.some(({ resolution }) => {
    const m = /^\s*(\d+)\s*[x×X*]\s*(\d+)\s*$/.exec(resolution ?? '');
    return !!m && Math.max(Number(m[1]), Number(m[2])) <= 1920 &&
      Math.min(Number(m[1]), Number(m[2])) <= 1080;
  });
  if (!lowerResolution) return null;
  const affected = assets.filter((asset) => {
    const meta = asset.processingMeta as Record<string, any> | null;
    const rendition = meta?.renditions?.['1080p'];
    if (typeof rendition?.url === 'string' && rendition.url.startsWith('https://') &&
        typeof rendition?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(rendition.sha256) &&
        Number.isSafeInteger(rendition.size) && rendition.size > 0) return false;
    const dims = meta?.processedDimensions ?? meta?.originalDimensions;
    const w = Number(dims?.w ?? meta?.probe?.codedWidth);
    const h = Number(dims?.h ?? meta?.probe?.codedHeight);
    return /^(video|image)\//.test(asset.mimeType ?? '') &&
      (!Number.isFinite(w) || !Number.isFinite(h) || Math.max(w, h) > 1920 || Math.min(w, h) > 1080);
  });
  if (!affected.length) return null;
  const videos = affected.filter((asset) => asset.mimeType?.startsWith('video/')).length;
  const images = affected.length - videos;
  const names = [videos ? `${videos} video${videos === 1 ? '' : 's'}` : '', images ? `${images} image${images === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  const unknownSize = affected.some((asset) => {
    const meta = asset.processingMeta as Record<string, any> | null;
    return !(meta?.processedDimensions ?? meta?.originalDimensions ?? meta?.probe);
  });
  return `${names} ${unknownSize ? 'may need' : 'need'} a 1080p playback copy for your selected screen${targets.length === 1 ? '' : 's'}. We’ll prepare it automatically before playback. The 4K version stays available for 4K screens.`;
}
