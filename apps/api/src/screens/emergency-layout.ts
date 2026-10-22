/** Existing primary/LED precedence is unchanged. A Presentation's CSS resolution
 * can be landscape even when its own configured/rotated face is portrait. */
export function emergencyLayoutIsPortrait(screen: {
  canvasW?: number | null; canvasH?: number | null;
  orientation?: string | null; resolution?: string | null; faceOfScreenId?: string | null;
}): boolean {
  const w = Number(screen.canvasW), h = Number(screen.canvasH);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return h > w;
  if (screen.faceOfScreenId) {
    if (screen.orientation === 'PORTRAIT') return true;
    if (screen.orientation === 'LANDSCAPE') return false;
  }
  const resolution = (screen.resolution || '').trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  return !!resolution && Number(resolution[2]) > Number(resolution[1]);
}

export function emergencyLayoutOrientation(screen: Parameters<typeof emergencyLayoutIsPortrait>[0]) {
  const portrait = emergencyLayoutIsPortrait(screen);
  return screen.faceOfScreenId ? (portrait ? 'PORTRAIT' : 'LANDSCAPE') : (portrait ? 'portrait' : 'landscape');
}
