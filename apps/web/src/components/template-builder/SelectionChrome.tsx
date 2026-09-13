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
}

export function SelectionChrome({ zone, onResizePointerDown }: Props) {
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
    </div>
  );
}
