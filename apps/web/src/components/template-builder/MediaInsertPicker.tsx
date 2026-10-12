'use client';

import { useEffect, useRef, useState } from 'react';
import { AssetLibraryModal } from './PropertiesPanel';
import { useBuilderStore } from './useBuilderStore';
import { mediaFrameGeometry, OPEN_MEDIA_PICKER_EVENT, readMediaDimensions, type MediaDimensions, type MediaKind, type MediaPickerRequest } from './media-sizing';
import { mediaSourcePatch } from './media-source';
import { replaceBoardMedia } from './board-media';

/** Mounted by the shell so changing the selected panel cannot close a pick. */
export function MediaInsertPicker() {
  const [request, setRequest] = useState<MediaPickerRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const picking = useRef(false);
  useEffect(() => {
    const lifetime = revision;
    const open = (event: Event) => {
      const detail = (event as CustomEvent<MediaPickerRequest>).detail;
      if (detail?.kind !== 'image' && detail?.kind !== 'video') return;
      revision.current++;
      picking.current = false;
      setBusy(false);
      setRequest(detail);
    };
    window.addEventListener(OPEN_MEDIA_PICKER_EVENT, open);
    return () => { lifetime.current++; window.removeEventListener(OPEN_MEDIA_PICKER_EVENT, open); };
  }, []);
  const close = () => { revision.current++; picking.current = false; setRequest(null); setBusy(false); };
  if (!request) return null;
  const pick = async (url: string, known?: MediaDimensions | null) => {
    if (picking.current) return;
    picking.current = true;
    setBusy(true);
    const version = revision.current;
    const templateId = useBuilderStore.getState().templateId;
    // Known size first (the library's server-measured metadata, or the local
    // file before upload); only otherwise read the file itself.
    const dimensions = known ?? await readMediaDimensions(url, request.kind);
    const st = useBuilderStore.getState();
    if (version !== revision.current || st.templateId !== templateId) return;
    if (request.zoneId) {
      const zone = st.zones.find(z => z.id === request.zoneId);
      if (zone && !zone.locked) {
        if (request.fieldKey) {
          replaceBoardMedia(zone.id, request.fieldKey, request.kind, url);
          close();
          return;
        }
        if (!request.replaceWidget) {
          st.updateZone(zone.id, mediaSourcePatch(zone, url, request.kind, dimensions, { width: st.meta.screenWidth, height: st.meta.screenHeight }), true);
          close();
          return;
        }
        // An explicit replacement preserves the existing layout. A first
        // file in an empty media frame gets a tight frame around its pixels.
        const cfg = zone.defaultConfig || {};
        const geometry = !cfg.assetUrl && !cfg.imageUrl && !cfg.url && dimensions
          ? mediaFrameGeometry(zone, dimensions, { width: st.meta.screenWidth, height: st.meta.screenHeight }) : {};
        st.updateZone(zone.id, { ...geometry, widgetType: request.kind === 'image' ? (zone.widgetType === 'LOGO' ? 'LOGO' : 'IMAGE') : 'VIDEO', defaultConfig: {
          ...cfg, variant: undefined, theme: undefined, assetUrl: url, imageUrl: undefined, url: undefined,
          ...(zone.widgetType === 'LOGO' ? { logoUrl: url } : {}),
          ...(dimensions ? { _mediaWidth: dimensions.width, _mediaHeight: dimensions.height } : { _mediaWidth: undefined, _mediaHeight: undefined }),
        } }, true);
      }
    } else {
      const id = st.addMediaZone(request.kind, url, dimensions, request.dropAt);
      if (!dimensions) void tightenWhenKnown(id, url, request.kind);
    }
    close();
  };
  return <>
    <AssetLibraryModal kind={request.kind} onPick={(url, dims) => void pick(url, dims)} onClose={close} />
    {busy && <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10002] rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">Adding {request.kind}…</div>}
  </>;
}

/**
 * The file's size could not be read in time (a slow 4K download, a video
 * whose index sits at the end), so the new zone landed in the generic
 * fallback box — a big empty frame around a portrait picture. Keep reading
 * for longer and, if the operator has not touched the zone meanwhile, shrink
 * the frame around the picture. Not an undo step of its own: it completes
 * the add the operator already made.
 */
export async function tightenWhenKnown(zoneId: string, url: string, kind: MediaKind, timeoutMs = 20000): Promise<boolean> {
  const start = useBuilderStore.getState().zones.find(z => z.id === zoneId);
  if (!start) return false;
  const dimensions = await readMediaDimensions(url, kind, timeoutMs);
  if (!dimensions) return false;
  const st = useBuilderStore.getState();
  const zone = st.zones.find(z => z.id === zoneId);
  if (!zone || zone.locked || (zone.defaultConfig || {}).assetUrl !== url) return false;
  if (zone.x !== start.x || zone.y !== start.y || zone.width !== start.width || zone.height !== start.height) return false;
  st.updateZone(zoneId, {
    ...mediaFrameGeometry(zone, dimensions, { width: st.meta.screenWidth, height: st.meta.screenHeight }),
    defaultConfig: { ...(zone.defaultConfig || {}), _mediaWidth: dimensions.width, _mediaHeight: dimensions.height },
  }, false);
  return true;
}
