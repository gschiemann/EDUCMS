'use client';

import { useEffect, useRef, useState } from 'react';
import { AssetLibraryModal } from './PropertiesPanel';
import { useBuilderStore } from './useBuilderStore';
import { mediaFrameGeometry, OPEN_MEDIA_PICKER_EVENT, readMediaDimensions, type MediaPickerRequest } from './media-sizing';
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
  const pick = async (url: string) => {
    if (picking.current) return;
    picking.current = true;
    setBusy(true);
    const version = revision.current;
    const templateId = useBuilderStore.getState().templateId;
    const dimensions = await readMediaDimensions(url, request.kind);
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
    } else st.addMediaZone(request.kind, url, dimensions, request.dropAt);
    close();
  };
  return <>
    <AssetLibraryModal kind={request.kind} onPick={url => void pick(url)} onClose={close} />
    {busy && <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10002] rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">Adding {request.kind}…</div>}
  </>;
}
