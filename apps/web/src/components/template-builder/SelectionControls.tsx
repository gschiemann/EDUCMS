'use client';

import { useState } from 'react';
import { Maximize2, RotateCcw, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { useBuilderStore } from './useBuilderStore';
import { mediaFrameGeometry, openMediaPicker, readMediaDimensions } from './media-sizing';
import type { BoardMediaField, Zone } from './types';
import { mediaRecord, patchBoardMedia } from './board-media';

export function normalizeRotation(angle: number) { return ((angle % 360) + 360) % 360; }

export function RotationControls({ zone }: { zone: Zone }) {
  const cfg = zone.defaultConfig || {};
  const angle = typeof cfg._zoneRotation === 'number' ? cfg._zoneRotation : 0;
  const rotate = (value: number) => {
    if (zone.locked || !Number.isFinite(value)) return;
    const st = useBuilderStore.getState();
    const current = st.zones.find(z => z.id === zone.id);
    if (!current || current.locked) return;
    st.updateZone(zone.id, { defaultConfig: { ...current.defaultConfig, _zoneRotation: normalizeRotation(value) } }, true);
  };
  return <RotationInputs angle={angle} locked={!!zone.locked} rotate={rotate} />;
}

function RotationInputs({ angle, locked, rotate }: { angle: number; locked: boolean; rotate: (value: number) => void }) {
  return <div role="group" aria-label="Rotation" className="flex shrink-0 items-center gap-1 border-l border-slate-200 pl-1">
    <button type="button" aria-label="Rotate left 90°" title="Rotate left 90°" disabled={locked} onClick={() => rotate(angle - 90)} className="h-8 w-8 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-40"><RotateCcw className="mx-auto h-4 w-4" aria-hidden /></button>
    <label className="flex items-center gap-1 text-[11px] text-slate-600">
      Rotate
      <input type="number" aria-label="Rotation in degrees" value={Math.round(angle)} disabled={locked} onChange={e => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) rotate(e.target.valueAsNumber); }} className="h-8 w-14 rounded border border-slate-200 px-1 text-xs text-slate-700 focus-visible:outline-indigo-500" />°
    </label>
    <button type="button" aria-label="Rotate right 90°" title="Rotate right 90°" disabled={locked} onClick={() => rotate(angle + 90)} className="h-8 w-8 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-40"><RotateCw className="mx-auto h-4 w-4" aria-hidden /></button>
  </div>;
}

export function MediaQuickControls({ zone }: { zone: Zone }) {
  const [fitting, setFitting] = useState(false);
  const cfg = zone.defaultConfig || {};
  const kind = zone.widgetType === 'VIDEO' ? 'video' : 'image';
  const source = String(cfg.assetUrl || cfg.imageUrl || cfg.logoUrl || cfg.url || '');
  const fit = String(cfg.fit || cfg.fitMode || (kind === 'video' ? 'cover' : 'contain'));
  const setFit = (value: string) => {
    const st = useBuilderStore.getState();
    const current = st.zones.find(z => z.id === zone.id);
    if (current && !current.locked) st.updateZone(zone.id, { defaultConfig: { ...current.defaultConfig, fit: value, fitMode: value } }, true);
  };
  const fitFrame = async () => {
    if (fitting || zone.locked || !source) return;
    setFitting(true);
    const templateId = useBuilderStore.getState().templateId;
    const dimensions = typeof cfg._mediaWidth === 'number' && cfg._mediaWidth > 0 && typeof cfg._mediaHeight === 'number' && cfg._mediaHeight > 0
      ? { width: cfg._mediaWidth, height: cfg._mediaHeight } : await readMediaDimensions(source, kind);
    const st = useBuilderStore.getState();
    const current = st.zones.find(z => z.id === zone.id);
    const currentCfg = current?.defaultConfig || {};
    if (dimensions && current && !current.locked && st.templateId === templateId && source === String(currentCfg.assetUrl || currentCfg.imageUrl || currentCfg.logoUrl || currentCfg.url || '')) {
      st.updateZone(zone.id, { ...mediaFrameGeometry(current, dimensions, { width: st.meta.screenWidth, height: st.meta.screenHeight }), defaultConfig: { ...currentCfg, fit: 'contain', fitMode: 'contain' } }, true);
    } else if (!dimensions && current && st.templateId === templateId) {
      toast.error(`Couldn't read this ${kind}'s size. Check that the file loads, then try again.`);
    }
    setFitting(false);
  };
  return <MediaInputs kind={kind} hasSource={!!source} locked={!!zone.locked} fit={fit} setFit={setFit} replace={() => openMediaPicker({ kind, zoneId: zone.id })}
    fitFrame={fitFrame} fitting={fitting} />;
}

function MediaInputs({ kind, hasSource, locked, fit, setFit, replace, fitFrame, fitting }: {
  kind: 'image' | 'video'; hasSource: boolean; locked: boolean; fit: string;
  setFit: (value: string) => void; replace: () => void; fitFrame?: () => Promise<void>; fitting?: boolean;
}) {
  return <div role="group" aria-label="Media controls" className="flex shrink-0 items-center gap-1">
    <button type="button" disabled={locked} onClick={replace} className="h-8 rounded-md px-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40">{hasSource ? 'Replace' : 'Choose'} {kind}</button>
    <select aria-label="Media fit" value={fit} disabled={locked} onChange={e => setFit(e.target.value)} className="h-8 rounded-md border border-slate-200 px-1 text-xs text-slate-700">
      <option value="contain">Show whole {kind}</option>
      <option value="cover">Fill frame (crop)</option>
      {fit === 'fill' && <option value="fill">Stretch</option>}
    </select>
    {fitFrame && <button type="button" aria-label={`Fit frame to ${kind}`} title={`Fit frame to ${kind} — remove empty space`} disabled={locked || !hasSource || fitting} onClick={() => void fitFrame()} className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"><Maximize2 className="h-3.5 w-3.5" aria-hidden />Fit frame</button>}
  </div>;
}

export function BoardMediaControls({ zone, field }: { zone: Zone; field: BoardMediaField }) {
  const cfg = zone.defaultConfig || {};
  const style = mediaRecord(mediaRecord(cfg.mediaStyles)[field.key]);
  const fit = String(style.fit || mediaRecord(cfg.textOverrides)[`media.${field.key}.fit`] || field.defaultFit);
  return <>
    <MediaInputs kind={field.kind} hasSource={field.hasSource || !!mediaRecord(field.kind === 'image' ? cfg.imageOverrides : cfg.videoOverrides)[field.key]} locked={!!zone.locked} fit={fit}
      setFit={value => patchBoardMedia(zone.id, field.key, { fit: value })}
      replace={() => openMediaPicker({ kind: field.kind, zoneId: zone.id, fieldKey: field.key })} />
    <RotationInputs angle={Number(style.rotation) || 0} locked={!!zone.locked} rotate={rotation => patchBoardMedia(zone.id, field.key, { rotation: normalizeRotation(rotation) })} />
  </>;
}
