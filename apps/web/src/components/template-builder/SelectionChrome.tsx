'use client';

/**
 * Selection chrome for the SINGLE selected zone — the indigo ring + the eight
 * resize handles — drawn as its own top-layer overlay in BuilderCanvas instead
 * of inside the zone.
 *
 * WHY (2026-09-13, template-maker audit). BuilderZone used to lift the selected
 * zone itself to `zIndex: 1000` "so its outline isn't buried under overlapping
 * zones". The side effect: selecting a full-screen zone — the filled placeholder
 * every new template starts from, a hero photo, a background video — put ALL of
 * its content above every other zone, so the moment an operator clicked the
 * background every widget on top of it vanished until they deselected. Measured
 * in the audit harness: with a full-screen note selected, `elementFromPoint` at
 * a clock zone's centre resolved to the note on 100% of a 9×9 grid.
 *
 * Zones now keep their own stacking order at all times (what you see is the
 * player's stacking), and only the CHROME rides above everything — the same
 * shape the multi-select group box in BuilderCanvas already uses. The ring is
 * `pointer-events: none` so it never steals a click from a zone underneath; the
 * handles opt back in.
 */

import type { Zone, ResizeHandle } from './types';
import { getZoneColor } from './constants';
import { RotateCw } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';

export const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const HANDLE_STYLES: Record<ResizeHandle, React.CSSProperties> = {
  nw: { top: -6, left: -6, cursor: 'nwse-resize' },
  n:  { top: -6, left: '50%', marginLeft: -6, cursor: 'ns-resize' },
  ne: { top: -6, right: -6, cursor: 'nesw-resize' },
  e:  { top: '50%', right: -6, marginTop: -6, cursor: 'ew-resize' },
  se: { bottom: -6, right: -6, cursor: 'nwse-resize' },
  s:  { bottom: -6, left: '50%', marginLeft: -6, cursor: 'ns-resize' },
  sw: { bottom: -6, left: -6, cursor: 'nesw-resize' },
  w:  { top: '50%', left: -6, marginTop: -6, cursor: 'ew-resize' },
};

/**
 * A full-canvas EXTERNAL_HTML board is edited through its own field list (the
 * educms-highlight bridge flashes the element inside the iframe), so it gets
 * neither the ring nor handles — a second outline around the whole canvas would
 * only be noise, and resizing a 100% board is meaningless.
 */
export const isFullCanvasExternalZone = (zone: Zone): boolean =>
  zone.widgetType === 'EXTERNAL_HTML' &&
  (zone.x ?? 0) <= 0.5 && (zone.y ?? 0) <= 0.5 &&
  (zone.width ?? 0) >= 99.5 && (zone.height ?? 0) >= 99.5;

/** The zone's own rotation, so the chrome turns with it (BuilderZone applies the same transform). */
const zoneRotation = (zone: Zone): number => {
  const c = (zone.defaultConfig || {}) as Record<string, unknown>;
  return typeof c._zoneRotation === 'number' ? c._zoneRotation : 0;
};

interface Props {
  zone: Zone;
  onResizePointerDown: (e: React.PointerEvent, zoneId: string, handle: ResizeHandle) => void;
  onRotatePointerDown?: (e: React.PointerEvent, zoneId: string) => void;
}

export function SelectionChrome({ zone, onResizePointerDown, onRotatePointerDown }: Props) {
  if (isFullCanvasExternalZone(zone)) return null;
  const rot = zoneRotation(zone);
  const canResize = !zone.locked;
  return (
    <div
      data-selection-chrome={zone.id}
      className="absolute"
      style={{
        left: `${zone.x}%`,
        top: `${zone.y}%`,
        width: `${zone.width}%`,
        height: `${zone.height}%`,
        // Above every zone (they keep their own zIndex), below the group box (1001).
        zIndex: 1000,
        pointerEvents: 'none',
        outline: '2px solid #6366f1',
        outlineOffset: 2,
        ...(rot ? { transform: `rotate(${rot}deg)` } : {}),
      }}
    >
      {canResize && HANDLES.map((h) => (
        <button
          key={h}
          type="button"
          aria-label={`Resize ${h}`}
          className="absolute w-3 h-3 rounded-sm bg-white border-2 shadow-sm hover:scale-125 transition-transform"
          style={{ ...HANDLE_STYLES[h], borderColor: getZoneColor(zone.widgetType).accent, pointerEvents: 'auto' }}
          onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(e, zone.id, h); }}
        />
      ))}
      {canResize && onRotatePointerDown && zone.widgetType !== 'EMPTY' && <>
        <div className="absolute left-1/2 -translate-x-1/2 w-px h-6 bg-indigo-500" style={{ bottom: -26 }} />
        <button type="button" aria-label="Rotate selection" title="Drag to rotate. Hold Shift for 15° steps. Arrow keys rotate; Home resets."
          className="absolute left-1/2 -translate-x-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-indigo-300 bg-white text-indigo-600 shadow-md cursor-grab active:cursor-grabbing"
          style={{ bottom: -56, pointerEvents: 'auto', touchAction: 'none' }}
          onPointerDown={e => { e.stopPropagation(); onRotatePointerDown(e, zone.id); }}
          onKeyDown={e => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(e.key)) return;
            e.preventDefault(); e.stopPropagation();
            const st = useBuilderStore.getState();
            const current = st.zones.find(z => z.id === zone.id);
            if (!current || current.locked) return;
            const angle = zoneRotation(current);
            const next = e.key === 'Home' ? 0 : angle + (['ArrowLeft', 'ArrowDown'].includes(e.key) ? -1 : 1) * (e.shiftKey ? 15 : 1);
            st.updateZone(zone.id, { defaultConfig: { ...current.defaultConfig, _zoneRotation: ((next % 360) + 360) % 360 } }, true);
          }}><RotateCw className="h-4 w-4" aria-hidden /></button>
      </>}
    </div>
  );
}
