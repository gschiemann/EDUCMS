import { useBuilderStore } from './useBuilderStore';
import { mediaFrameGeometry, readMediaDimensions, type MediaKind, type MediaDimensions } from './media-sizing';
import type { Zone } from './types';

export function mediaSourcePatch(current: Zone, url: string, kind: MediaKind, dimensions: MediaDimensions | null, canvas: MediaDimensions): Partial<Zone> {
  const cfg = current.defaultConfig || {};
  const plainFrame = !cfg.theme && (!cfg.variant || cfg.variant === 'image-basic' || cfg.variant === 'video-basic');
  const geometry = plainFrame && !cfg.assetUrl && !cfg.imageUrl && !cfg.logoUrl && !cfg.url && dimensions
    ? mediaFrameGeometry(current, dimensions, canvas) : {};
  return { ...geometry, defaultConfig: {
    ...cfg, assetUrl: url, imageUrl: undefined,
    ...(current.widgetType === 'LOGO' ? { logoUrl: url } : {}),
    ...(kind === 'video' ? { url: undefined } : {}),
    ...(dimensions ? { _mediaWidth: dimensions.width, _mediaHeight: dimensions.height } : { _mediaWidth: undefined, _mediaHeight: undefined }),
  } };
}

/** Keep replacements in their layout; tighten a new empty frame on first pick. */
export async function assignMediaSource(zoneId: string, url: string, kind: MediaKind) {
  const before = useBuilderStore.getState();
  const original = before.zones.find(z => z.id === zoneId);
  if (!original || original.locked) return;
  const originalConfig = original.defaultConfig;
  const dimensions = url ? await readMediaDimensions(url, kind) : null;
  const st = useBuilderStore.getState();
  const current = st.zones.find(z => z.id === zoneId);
  if (!current || current.locked || st.templateId !== before.templateId || current.defaultConfig !== originalConfig) return;
  st.updateZone(zoneId, mediaSourcePatch(current, url, kind, dimensions, { width: st.meta.screenWidth, height: st.meta.screenHeight }), true);
}
