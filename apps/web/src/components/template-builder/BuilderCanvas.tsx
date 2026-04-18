"use client";

import { useRef, useEffect, useState, useCallback } from 'react';
import { useBuilderStore } from './useBuilderStore';
import { BuilderZone } from './BuilderZone';
import { snapMove, snapResize } from './snap-engine';
import type { ResizeHandle, SnapLine, Zone } from './types';

export function BuilderCanvas() {
  const {
    zones, meta, selectedIds, zoom, gridSize, showGrid, snapEnabled, showGuides,
    previewMode, select, updateZone, updateZones, beginTransaction,
  } = useBuilderStore();

  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<
    | { mode: 'move'; zoneId: string; startX: number; startY: number; origs: Record<string, Zone> }
    | { mode: 'resize'; zoneId: string; handle: ResizeHandle; startX: number; startY: number; orig: Zone }
    | null
  >(null);
  const [marqueeState, setMarqueeState] = useState<{ startX: number; startY: number; currX: number; currY: number } | null>(null);
  const [activeSnapLines, setActiveSnapLines] = useState<SnapLine[]>([]);

  const aspectRatio = meta.screenWidth / meta.screenHeight;

  const onZonePointerDown = useCallback((e: React.PointerEvent, zoneId: string) => {
    e.preventDefault();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const alreadySelected = selectedIds.includes(zoneId);
    if (!alreadySelected && !additive) {
      select([zoneId]);
    } else if (additive) {
      select([zoneId], true);
    }
    beginTransaction();
    const selectionForDrag = alreadySelected ? selectedIds : additive ? Array.from(new Set([...selectedIds, zoneId])) : [zoneId];
    const origs: Record<string, Zone> = {};
    for (const id of selectionForDrag) {
      const z = zones.find(zz => zz.id === id);
      if (z && !z.locked) origs[id] = { ...z };
    }
    setDragState({ mode: 'move', zoneId, startX: e.clientX, startY: e.clientY, origs });
  }, [zones, selectedIds, select, beginTransaction]);

  const onResizePointerDown = useCallback((e: React.PointerEvent, zoneId: string, handle: ResizeHandle) => {
    e.preventDefault();
    e.stopPropagation();
    select([zoneId]);
    const orig = zones.find(z => z.id === zoneId);
    if (!orig) return;
    beginTransaction();
    setDragState({ mode: 'resize', zoneId, handle, startX: e.clientX, startY: e.clientY, orig: { ...orig } });
  }, [zones, select, beginTransaction]);

  const onZoneSelect = useCallback((e: React.MouseEvent, zoneId: string) => {
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    select([zoneId], additive);
  }, [select]);

  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dx = (e.clientX - dragState.startX) / rect.width * 100;
      const dy = (e.clientY - dragState.startY) / rect.height * 100;

      if (dragState.mode === 'move') {
        const ids = Object.keys(dragState.origs);
        const primary = dragState.origs[dragState.zoneId];
        if (!primary) return;
        const proposed = {
          x: primary.x + dx,
          y: primary.y + dy,
          width: primary.width,
          height: primary.height,
        };
        const others = zones.filter(z => !ids.includes(z.id));
        const snapped = snapMove(proposed, others, {
          gridSize,
          snapEnabled,
          snapGrid: showGrid,
        });
        const actualDx = snapped.x - primary.x;
        const actualDy = snapped.y - primary.y;
        setActiveSnapLines(showGuides ? snapped.lines : []);
        updateZones(ids, (z) => {
          const orig = dragState.origs[z.id];
          return { x: orig.x + actualDx, y: orig.y + actualDy };
        });
      } else {
        const o = dragState.orig;
        const h = dragState.handle;
        let nx = o.x, ny = o.y, nw = o.width, nh = o.height;
        if (h.includes('e')) nw = Math.max(3, o.width + dx);
        if (h.includes('s')) nh = Math.max(3, o.height + dy);
        if (h.includes('w')) { const s = Math.min(dx, o.width - 3); nx = o.x + s; nw = o.width - s; }
        if (h.includes('n')) { const s = Math.min(dy, o.height - 3); ny = o.y + s; nh = o.height - s; }
        const others = zones.filter(z => z.id !== dragState.zoneId);
        const snapped = snapResize({ x: nx, y: ny, width: nw, height: nh }, others, h, {
          gridSize,
          snapEnabled,
          snapGrid: showGrid,
        });
        setActiveSnapLines(showGuides ? snapped.lines : []);
        updateZone(dragState.zoneId, snapped);
      }
    };
    const onUp = () => {
      setDragState(null);
      setActiveSnapLines([]);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragState, zones, gridSize, snapEnabled, showGrid, showGuides, updateZone, updateZones]);

  // Marquee selection
  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (previewMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * 100;
    const sy = (e.clientY - rect.top) / rect.height * 100;
    if (!(e.shiftKey || e.metaKey || e.ctrlKey)) {
      select(null);
    }
    setMarqueeState({ startX: sx, startY: sy, currX: sx, currY: sy });
  }, [select, previewMode]);

  useEffect(() => {
    if (!marqueeState) return;
    const onMove = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100));
      const cy = Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100));
      setMarqueeState(m => m ? { ...m, currX: cx, currY: cy } : null);
    };
    const onUp = () => {
      if (!marqueeState) return;
      const x1 = Math.min(marqueeState.startX, marqueeState.currX);
      const y1 = Math.min(marqueeState.startY, marqueeState.currY);
      const x2 = Math.max(marqueeState.startX, marqueeState.currX);
      const y2 = Math.max(marqueeState.startY, marqueeState.currY);
      const width = x2 - x1, height = y2 - y1;
      if (width > 0.5 && height > 0.5) {
        const hit = zones.filter(z =>
          z.x < x2 && z.x + z.width > x1 && z.y < y2 && z.y + z.height > y1,
        ).map(z => z.id);
        select(hit);
      }
      setMarqueeState(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [marqueeState, zones, select]);

  const background = meta.bgImage
    ? { backgroundImage: meta.bgImage.trim().startsWith('url(') ? meta.bgImage : `url(${meta.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : meta.bgGradient
      ? { background: meta.bgGradient }
      : { background: meta.bgColor || '#ffffff' };

  const gridStep = gridSize;
  const gridBg = showGrid && !previewMode ? {
    backgroundImage: `
      linear-gradient(to right, rgba(100,116,139,0.08) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(100,116,139,0.08) 1px, transparent 1px)
    `,
    backgroundSize: `${gridStep}% ${gridStep}%`,
  } : {};

  return (
    <div className="flex-1 overflow-auto bg-slate-200 p-8 flex items-center justify-center min-h-0">
      <div
        className="shadow-2xl rounded-lg relative"
        style={{
          width: `min(${90 * zoom}vw, ${aspectRatio * 70 * zoom}vh)`,
          aspectRatio: `${aspectRatio}`,
          maxWidth: '100%',
        }}
      >
        <div
          ref={canvasRef}
          className="absolute inset-0 rounded-lg overflow-hidden"
          style={{ ...background }}
          onPointerDown={onCanvasPointerDown}
          role="application"
          aria-label="Template canvas"
        >
          {showGrid && !previewMode && (
            <div className="absolute inset-0 pointer-events-none" style={gridBg} aria-hidden />
          )}

          {zones.map(zone => (
            <BuilderZone
              key={zone.id}
              zone={zone}
              selected={selectedIds.includes(zone.id)}
              previewMode={previewMode}
              onPointerDown={onZonePointerDown}
              onResizePointerDown={onResizePointerDown}
              onSelect={onZoneSelect}
            />
          ))}

          {showGuides && activeSnapLines.map((line, i) => (
            <div
              key={i}
              aria-hidden
              className="absolute pointer-events-none"
              style={
                line.orientation === 'v'
                  ? { left: `${line.position}%`, top: 0, bottom: 0, width: 1, background: line.kind === 'canvas' ? '#a855f7' : '#ec4899', boxShadow: '0 0 4px rgba(168,85,247,0.6)' }
                  : { top: `${line.position}%`, left: 0, right: 0, height: 1, background: line.kind === 'canvas' ? '#a855f7' : '#ec4899', boxShadow: '0 0 4px rgba(168,85,247,0.6)' }
              }
            />
          ))}

          {marqueeState && (
            <div
              aria-hidden
              className="absolute border-2 border-indigo-500 bg-indigo-500/10 pointer-events-none"
              style={{
                left: `${Math.min(marqueeState.startX, marqueeState.currX)}%`,
                top: `${Math.min(marqueeState.startY, marqueeState.currY)}%`,
                width: `${Math.abs(marqueeState.currX - marqueeState.startX)}%`,
                height: `${Math.abs(marqueeState.currY - marqueeState.startY)}%`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
