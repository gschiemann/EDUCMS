import { useBuilderStore } from './useBuilderStore';
import type { MediaKind } from './media-sizing';

export function mediaRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function patchBoardMedia(zoneId: string, key: string, patch: { fit?: string; rotation?: number; hidden?: boolean }) {
  const st = useBuilderStore.getState();
  const zone = st.zones.find(z => z.id === zoneId);
  if (zone?.widgetType !== 'EXTERNAL_HTML' || zone.locked || st.previewMode) return;
  const cfg = zone.defaultConfig || {};
  const styles = mediaRecord(cfg.mediaStyles);
  const mediaStyles = { ...styles, [key]: { ...mediaRecord(styles[key]), ...patch } };
  st.updateZone(zoneId, { defaultConfig: { ...cfg, mediaStyles } }, true);
}

export function replaceBoardMedia(zoneId: string, key: string, kind: MediaKind, url: string) {
  const st = useBuilderStore.getState();
  const zone = st.zones.find(z => z.id === zoneId);
  if (zone?.widgetType !== 'EXTERNAL_HTML' || zone.locked || st.previewMode) return;
  const cfg = zone.defaultConfig || {};
  const map = kind === 'video' ? 'videoOverrides' : 'imageOverrides';
  const sources = mediaRecord(cfg[map]);
  const previous = sources[key];
  const value = Array.isArray(previous) ? [url, ...previous.slice(1)] : url;
  const styles = mediaRecord(cfg.mediaStyles);
  const style = mediaRecord(styles[key]);
  const show = style.hidden === true ? { mediaStyles: { ...styles, [key]: { ...style, hidden: false } } } : {};
  st.updateZone(zoneId, { defaultConfig: { ...cfg, ...show, [map]: { ...sources, [key]: value } } }, true);
  if (st.activeMediaField?.zoneId === zoneId && st.activeMediaField.key === key) st.setActiveMediaField({ ...st.activeMediaField, hasSource: true });
}
