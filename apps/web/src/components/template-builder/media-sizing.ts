import { API_URL } from '@/lib/api-url';

export type MediaKind = 'image' | 'video';
export interface MediaDimensions { width: number; height: number }

export const OPEN_MEDIA_PICKER_EVENT = 'builder-open-media-picker';
export interface MediaPickerRequest {
  kind: MediaKind;
  zoneId?: string;
  replaceWidget?: boolean;
  fieldKey?: string;
  dropAt?: { x: number; y: number };
}

export function openMediaPicker(request: MediaPickerRequest) {
  window.dispatchEvent(new CustomEvent(OPEN_MEDIA_PICKER_EVENT, { detail: request }));
}

/** Original pixels, scaled down only when necessary to leave editing room. */
export function naturalMediaSize(source: MediaDimensions, canvas: MediaDimensions) {
  const scale = Math.min(1, canvas.width * 0.75 / source.width, canvas.height * 0.75 / source.height);
  return { w: source.width * scale / canvas.width * 100, h: source.height * scale / canvas.height * 100 };
}

/** Tighten a frame around the entire picture without enlarging the frame. */
export function mediaFrameGeometry(zone: { x: number; y: number; width: number; height: number }, source: MediaDimensions, canvas: MediaDimensions) {
  const scale = Math.min(zone.width / 100 * canvas.width / source.width, zone.height / 100 * canvas.height / source.height);
  const width = source.width * scale / canvas.width * 100;
  const height = source.height * scale / canvas.height * 100;
  return { x: zone.x + (zone.width - width) / 2, y: zone.y + (zone.height - height) / 2, width, height };
}

/**
 * The server-measured size of a library asset (`processingMeta`, written by
 * sharp at upload for a picture and by ffprobe for a video — the DISPLAY
 * size, so a portrait phone clip is 1080×1920). Known without loading a
 * byte, so a picked file gets a frame that hugs it even when the file is a
 * slow 4K download that would outlast the browser read below.
 */
export function assetMetaDimensions(asset: unknown): MediaDimensions | null {
  const pm = (asset as { processingMeta?: Record<string, { w?: unknown; h?: unknown } | undefined> } | null | undefined)?.processingMeta;
  const d = pm?.processedDimensions ?? pm?.originalDimensions;
  return d && Number(d.w) > 0 && Number(d.h) > 0 ? { width: Number(d.w), height: Number(d.h) } : null;
}

/** Metadata only for video. Bounded and cleaned up even for a broken URL. */
export function readMediaDimensions(url: string, kind: MediaKind, timeoutMs = 5000): Promise<MediaDimensions | null> {
  if (!url || typeof document === 'undefined') return Promise.resolve(null);
  const src = /^(https?:|data:|blob:)/.test(url) || url.startsWith('/templates/')
    ? url : `${API_URL.replace(/\/api\/v1\/?$/, '')}${url}`;
  return new Promise(resolve => {
    const el = kind === 'image' ? new Image() : document.createElement('video');
    const finish = (dimensions: MediaDimensions | null) => {
      clearTimeout(timer);
      el.onload = el.onerror = null;
      if (el instanceof HTMLVideoElement) {
        el.onloadedmetadata = null;
        el.removeAttribute('src');
        el.load();
      }
      resolve(dimensions);
    };
    const loaded = () => {
      const width = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
      const height = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
      finish(width > 0 && height > 0 ? { width, height } : null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    el.onerror = () => finish(null);
    if (el instanceof HTMLVideoElement) {
      el.preload = 'metadata';
      el.onloadedmetadata = loaded;
    } else el.onload = loaded;
    el.src = src;
  });
}
