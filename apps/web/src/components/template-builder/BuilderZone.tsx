"use client";

import { createElement, memo } from 'react';
import { Lock } from 'lucide-react';
import type { Zone, ResizeHandle } from './types';
import { getZoneColor, widgetIcon, widgetLabel } from './constants';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';

interface Props {
  zone: Zone;
  selected: boolean;
  previewMode: boolean;
  onPointerDown: (e: React.PointerEvent, zoneId: string, mode: 'move') => void;
  onResizePointerDown: (e: React.PointerEvent, zoneId: string, handle: ResizeHandle) => void;
  onSelect: (e: React.MouseEvent, zoneId: string) => void;
}

const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_STYLES: Record<ResizeHandle, React.CSSProperties> = {
  nw: { top: -6, left: -6, cursor: 'nwse-resize' },
  n:  { top: -6, left: '50%', marginLeft: -6, cursor: 'ns-resize' },
  ne: { top: -6, right: -6, cursor: 'nesw-resize' },
  e:  { top: '50%', right: -6, marginTop: -6, cursor: 'ew-resize' },
  se: { bottom: -6, right: -6, cursor: 'nwse-resize' },
  s:  { bottom: -6, left: '50%', marginLeft: -6, cursor: 'ns-resize' },
  sw: { bottom: -6, left: -6, cursor: 'nesw-resize' },
  w:  { top: '50%', left: -6, marginTop: -6, cursor: 'ew-resize' },
};

function BuilderZoneImpl({ zone, selected, previewMode, onPointerDown, onResizePointerDown, onSelect }: Props) {
  const color = getZoneColor(zone.widgetType);
  const icon = widgetIcon(zone.widgetType);
  const label = widgetLabel(zone.widgetType);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(e as unknown as React.MouseEvent, zone.id);
    }
  };

  return (
    <div
      role="button"
      tabIndex={previewMode ? -1 : 0}
      aria-label={`${label} zone: ${zone.name}`}
      aria-pressed={selected}
      className={`absolute group transition-[box-shadow] ${selected ? 'shadow-2xl' : 'hover:shadow-lg'}`}
      style={{
        left: `${zone.x}%`,
        top: `${zone.y}%`,
        width: `${zone.width}%`,
        height: `${zone.height}%`,
        zIndex: zone.zIndex,
        background: previewMode ? 'transparent' : color.bg,
        border: previewMode ? 'none' : `2px solid ${selected ? color.accent : color.border}`,
        boxShadow: selected ? `0 0 0 2px ${color.accent}40` : undefined,
        outline: 'none',
        cursor: zone.locked || previewMode ? 'default' : 'move',
        userSelect: 'none',
        overflow: 'hidden',
      }}
      onPointerDown={(e) => {
        if (previewMode || zone.locked) return;
        onPointerDown(e, zone.id, 'move');
      }}
      onClick={(e) => {
        if (previewMode) return;
        e.stopPropagation();
        onSelect(e, zone.id);
      }}
      onKeyDown={handleKeyDown}
      data-zone-id={zone.id}
    >
      {previewMode ? (
        <WidgetPreview
          widgetType={zone.widgetType}
          config={zone.defaultConfig || {}}
          width={zone.width}
          height={zone.height}
          live={false}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-2 pointer-events-none">
          {createElement(icon, { className: 'w-6 h-6 mb-1', style: { color: color.accent }, 'aria-hidden': true })}
          <span className="text-[11px] font-bold text-center truncate max-w-full" style={{ color: color.text }}>
            {zone.name}
          </span>
          <span className="text-[9px] uppercase tracking-wider font-semibold opacity-60" style={{ color: color.text }}>
            {label}
          </span>
        </div>
      )}

      {zone.locked && !previewMode && (
        <div className="absolute top-1 right-1 bg-slate-800/80 text-white rounded-full p-1" aria-label="Locked">
          <Lock className="w-3 h-3" aria-hidden />
        </div>
      )}

      {selected && !previewMode && !zone.locked && HANDLES.map((h) => (
        <button
          key={h}
          type="button"
          aria-label={`Resize ${h}`}
          className="absolute w-3 h-3 rounded-sm bg-white border-2 shadow-sm hover:scale-125 transition-transform"
          style={{ ...HANDLE_STYLES[h], borderColor: color.accent }}
          onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(e, zone.id, h); }}
        />
      ))}
    </div>
  );
}

export const BuilderZone = memo(BuilderZoneImpl);
