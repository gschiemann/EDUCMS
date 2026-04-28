"use client";

import { useRef, useEffect, useState, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  Copy, Lock, Unlock, ChevronUp, ChevronDown, Trash2,
  Bold, Italic, Palette, AlignLeft, AlignCenter, AlignRight,
  RefreshCw, Maximize2, Clock, Thermometer, Gauge, Calendar, Globe, MousePointer,
} from 'lucide-react';
import { AssetLibraryModal } from './PropertiesPanel';
import { useBuilderStore } from './useBuilderStore';
import { BuilderZone } from './BuilderZone';
import { snapMove, snapResize } from './snap-engine';
import type { ResizeHandle, SnapLine, Zone } from './types';

export function BuilderCanvas() {
  // dnd-kit drop target. BuilderShell.handleDragEnd checks
  // `over.id === 'builder-canvas'` to know whether to add a zone, but
  // before this fix the canvas wasn't registered as a droppable at all
  // — so palette / variant drags resolved to `over === null` and the
  // dropped widget never landed on the canvas. Operator could drag a
  // widget tile across the canvas surface and nothing would place.
  // Critical bug for the headline template-builder feature.
  const { setNodeRef: setDroppableRef } = useDroppable({ id: 'builder-canvas' });
  // Atomic selectors — BuilderCanvas paints every frame of every drag,
  // so subscribing to the whole store was forcing re-renders on every
  // unrelated state tick (e.g. isDirty flag flipping). Per-key lets
  // Zustand skip the render entirely when nothing this component cares
  // about changed.
  const zones = useBuilderStore((s) => s.zones);
  const meta = useBuilderStore((s) => s.meta);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const zoom = useBuilderStore((s) => s.zoom);
  const gridSize = useBuilderStore((s) => s.gridSize);
  const showGrid = useBuilderStore((s) => s.showGrid);
  const snapEnabled = useBuilderStore((s) => s.snapEnabled);
  const showGuides = useBuilderStore((s) => s.showGuides);
  const previewMode = useBuilderStore((s) => s.previewMode);
  const select = useBuilderStore((s) => s.select);
  const updateZone = useBuilderStore((s) => s.updateZone);
  const updateZones = useBuilderStore((s) => s.updateZones);
  const beginTransaction = useBuilderStore((s) => s.beginTransaction);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<
    | { mode: 'move'; zoneId: string; startX: number; startY: number; origs: Record<string, Zone> }
    | { mode: 'resize'; zoneId: string; handle: ResizeHandle; startX: number; startY: number; orig: Zone }
    | null
  >(null);
  const [marqueeState, setMarqueeState] = useState<{ startX: number; startY: number; currX: number; currY: number } | null>(null);
  const [activeSnapLines, setActiveSnapLines] = useState<SnapLine[]>([]);
  const [hoverFromDrag, setHoverFromDrag] = useState(false);

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
          // Compose refs: BuilderCanvas needs the DOM node for its own
          // pointer-drag math (canvasRef), and dnd-kit needs it as the
          // drop-target node (setDroppableRef). Both run on every drop.
          ref={(node) => {
            canvasRef.current = node;
            setDroppableRef(node);
          }}
          className="absolute inset-0 rounded-lg overflow-hidden"
          style={{ ...background }}
          onPointerDown={onCanvasPointerDown}
          onDragEnter={() => setHoverFromDrag(true)}
          onDragLeave={() => setHoverFromDrag(false)}
          onDrop={() => setHoverFromDrag(false)}
          role="application"
          aria-label="Template canvas"
        >
          {showGrid && !previewMode && (
            <div className="absolute inset-0 pointer-events-none" style={gridBg} aria-hidden />
          )}

          {/* Empty-canvas onboarding (C7 from Canva parity sweep). When
              the operator opens a fresh custom template, an arrow points
              left at the Widgets tab + a copy line nudges them to drag.
              Auto-hides as soon as the first zone lands. Hidden in
              previewMode so demo screenshots stay clean. Also hidden
              during drag-over to unblock drop target.
              2026-04-28 fix — operator: 'no fucking background get
              apploed to the canvas. it stays white that the entire
              issue.' Cause: this card was bg-white/85 and covered
              ~70% of the canvas surface, so the gradient WAS being
              applied to the canvas div underneath but the white card
              was hiding it. Two changes:
                a) Hide the card when the operator has set a background
                   — they've clearly moved past 'drag a widget here'
                   and we shouldn't fight them with a white tooltip.
                b) Drop the card to a small chip pinned to the top
                   so the canvas bg is fully visible. */}
          {zones.length === 0 && !previewMode && !hoverFromDrag && !meta.bgColor && !meta.bgGradient && !meta.bgImage && (
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none flex items-center justify-center"
            >
              <div className="flex items-center gap-4 px-8 py-6 rounded-2xl bg-white/85 backdrop-blur-sm shadow-lg border border-indigo-200/60 max-w-md">
                <svg viewBox="0 0 64 64" className="w-12 h-12 shrink-0 text-indigo-500" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M48 32 H10" />
                  <path d="M22 18 L8 32 L22 46" />
                </svg>
                <div>
                  <p className="text-sm font-bold text-slate-800">Drag a widget onto the canvas to start</p>
                  <p className="text-xs text-slate-500 mt-1">Pick from the <strong className="text-indigo-600">Widgets</strong> tab on the left — Clock, Weather, Text, Image, Web page, and more.</p>
                </div>
              </div>
            </div>
          )}
          {/* Compact follow-up nudge — once the operator has painted
              a bg they're decorating, but if zones is still empty
              they may want a hint to add widgets. Small corner chip
              that doesn't obscure the canvas bg. */}
          {zones.length === 0 && !previewMode && !hoverFromDrag && (meta.bgColor || meta.bgGradient || meta.bgImage) && (
            <div
              aria-hidden
              className="absolute top-3 left-3 pointer-events-none px-3 py-1.5 rounded-full bg-white/80 backdrop-blur-sm shadow-md border border-indigo-200/60 text-[10px] font-bold text-indigo-700 tracking-wider uppercase"
            >
              Now add a widget →
            </div>
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
              // Inline-edit hook: when a widget's EditableText commits a
              // change, patch the zone's defaultConfig. `true` marks the
              // update dirty/undoable. Without this, double-clicking a
              // text node did nothing — the whole EditableText chain
              // short-circuits to read-only when onConfigChange is
              // undefined.
              onConfigChange={(zoneId, patch) => {
                const z = zones.find(z => z.id === zoneId);
                if (!z) return;
                updateZone(zoneId, { defaultConfig: { ...(z.defaultConfig || {}), ...patch } }, true);
              }}
            />
          ))}

          {showGuides && activeSnapLines.map((line, i) => {
            // Human-readable label for the snap line — operators
            // shouldn't have to guess what the pink line means. Center
            // canvas snap → "Center". Edge canvas → "Edge". Element
            // snaps → the position percent rounded to 1 decimal.
            // (Canva shows pixel offsets between elements; we'd need
            // both end positions to compute that, so percent-of-canvas
            // is a clean v1 — matches the way every editor field is
            // already in percent units.)
            const isCenterCanvas = line.kind === 'canvas' && Math.abs(line.position - 50) < 0.05;
            const isEdgeCanvas   = line.kind === 'canvas' && (line.position < 0.05 || line.position > 99.95);
            const isCenterElem   = line.kind === 'center';
            const label = isCenterCanvas
              ? 'Center'
              : isEdgeCanvas
                ? 'Edge'
                : isCenterElem
                  ? 'Center match'
                  : `${line.position.toFixed(1)}%`;
            const lineColor = line.kind === 'canvas' ? '#a855f7' : '#ec4899';
            return (
              <div
                key={i}
                aria-hidden
                className="absolute pointer-events-none"
                style={
                  line.orientation === 'v'
                    ? { left: `${line.position}%`, top: 0, bottom: 0, width: 1, background: lineColor, boxShadow: '0 0 4px rgba(168,85,247,0.6)' }
                    : { top: `${line.position}%`, left: 0, right: 0, height: 1, background: lineColor, boxShadow: '0 0 4px rgba(168,85,247,0.6)' }
                }
              >
                <span
                  style={{
                    position: 'absolute',
                    background: lineColor,
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    ...(line.orientation === 'v'
                      ? { top: '50%', left: 4, transform: 'translateY(-50%)' }
                      : { left: '50%', top: 4, transform: 'translateX(-50%)' }
                    ),
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}

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

          {/* Floating quick-actions bar over the selected zone (Canva
              pattern). Single-selection only — multi-select would mean
              positioning math is ambiguous, and the LayersPanel hover
              row already covers bulk ops. */}
          {!previewMode && selectedIds.length === 1 && (() => {
            const z = zones.find(zz => zz.id === selectedIds[0]);
            if (!z) return null;
            return <FloatingZoneActions zone={z} />;
          })()}
        </div>
      </div>
    </div>
  );
}

/** Quick-actions toolbar that floats just below (or above when
 *  there's no room) the selected zone. Mirrors Canva's "this is
 *  selected, here are the most-common things you'd do next" UX.
 *
 *  TYPE-AWARE section renders BEFORE the generic cluster, separated
 *  by a vertical divider. Widget types not in the list get only the
 *  generic 5 (Duplicate / Forward / Back / Lock / Delete). */
function FloatingZoneActions({ zone }: { zone: Zone }) {
  // Hide floating bar for tiny zones — buttons would overwhelm the
  // widget and the bar positioning math breaks below 8% width or 5% height.
  if (zone.width < 8 || zone.height < 5) return null;

  const duplicateZone   = useBuilderStore((s) => s.duplicateZone);
  const removeSelected  = useBuilderStore((s) => s.removeSelected);
  const toggleLock      = useBuilderStore((s) => s.toggleLock);
  const moveLayer       = useBuilderStore((s) => s.moveLayer);
  const updateZone      = useBuilderStore((s) => s.updateZone);

  // Local popover state — one flag per popover so multiple can't open
  // at once (clicking a second button closes any open one because its
  // flag was never set).
  const [colorOpen, setColorOpen]   = useState(false);
  const [urlOpen, setUrlOpen]       = useState(false);
  const [dateOpen, setDateOpen]     = useState(false);
  const [assetOpen, setAssetOpen]   = useState(false);

  const cfg = (zone.defaultConfig || {}) as Record<string, any>;

  /** Write a config patch without changing anything else on the zone.
   *  Uses `true` as the second arg so the store marks the template dirty. */
  const setCfg = (patch: Record<string, any>) => {
    updateZone(zone.id, { defaultConfig: { ...cfg, ...patch } }, true);
  };

  // Position the bar centered horizontally over the zone. Default
  // anchor is just BELOW the zone (matches Canva). Flip above when
  // the bar would sit too close to the canvas's bottom edge — bar
  // height ~36px + 8px translateY offset = ~44px clearance needed.
  // Below 88% the bar still has room; at 88-100% we flip up.
  // Horizontally clamp so the bar's center can't push it off the
  // canvas (zone at x=2% with width=4% would otherwise center at 4%
  // and clip the left half of a 240px-wide bar).
  const flipAbove = zone.y + zone.height > 88;
  const top  = flipAbove
    ? `calc(${zone.y}% - 36px)`
    : `${zone.y + zone.height}%`;
  const centerX = zone.x + zone.width / 2;
  const left = `${Math.max(8, Math.min(92, centerX))}%`;

  const btn = (label: string, onClick: () => void, icon: React.ReactNode, danger = false, active = false) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
        danger
          ? 'text-slate-500 hover:bg-rose-50 hover:text-rose-600'
          : active
            ? 'bg-indigo-100 text-indigo-700'
            : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {icon}
    </button>
  );

  // ── Type-aware quick-action buttons ──────────────────────────────
  const wt = zone.widgetType;
  const isText    = wt === 'TEXT' || wt === 'RICH_TEXT';
  const isImage   = wt === 'IMAGE' || wt === 'IMAGE_CAROUSEL' || wt === 'LOGO';
  const isClock   = wt === 'CLOCK';
  const isWeather = wt === 'WEATHER';
  const isTicker  = wt === 'TICKER';
  const isCountdown = wt === 'COUNTDOWN';
  const isWebpage = wt === 'WEBPAGE';

  const hasTypeActions = isText || isImage || isClock || isWeather || isTicker || isCountdown || isWebpage;

  // ── Color swatches for the text color popover ──────────────────────
  const COLOR_SWATCHES = ['#ffffff','#0f172a','#64748b','#ef4444','#f59e0b','#10b981','#0ea5e9','#7c3aed'];

  return (
    <div
      role="toolbar"
      aria-label="Selected widget actions"
      className="absolute z-30 bg-white border border-slate-200 rounded-lg shadow-lg flex items-center gap-0.5 px-1 py-1"
      style={{
        top,
        left,
        transform: 'translate(-50%, 8px)',
        // Don't capture pointer events that started outside the bar
        // (e.g. drag of the zone itself). Buttons retain their own
        // pointer-events.
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* ── TEXT / RICH_TEXT ── */}
      {isText && (<>
        {btn(
          cfg.bold ? 'Remove bold' : 'Bold',
          () => setCfg({ bold: !cfg.bold }),
          <Bold className="w-3.5 h-3.5" />,
          false,
          cfg.bold === true,
        )}
        {btn(
          cfg.italic ? 'Remove italic' : 'Italic',
          () => setCfg({ italic: !cfg.italic }),
          <Italic className="w-3.5 h-3.5" />,
          false,
          cfg.italic === true,
        )}
        {/* Color popover */}
        <div className="relative">
          <button
            type="button"
            aria-label="Text color"
            title="Text color"
            onClick={(e) => { e.stopPropagation(); setColorOpen((v) => !v); setUrlOpen(false); setDateOpen(false); setAssetOpen(false); }}
            className="w-8 h-8 rounded-md flex items-center justify-center transition-colors text-slate-600 hover:bg-slate-100"
          >
            <Palette className="w-3.5 h-3.5" />
          </button>
          {colorOpen && (
            <div
              className="absolute z-40 bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-44"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {COLOR_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    title={c}
                    onClick={() => { setCfg({ color: c }); setColorOpen(false); }}
                    className="w-7 h-7 rounded-md border border-slate-200 shadow-sm hover:scale-110 transition-transform"
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-slate-500 font-semibold">Hex</span>
                <input
                  type="text"
                  defaultValue={cfg.color || '#000000'}
                  maxLength={7}
                  placeholder="#000000"
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^#[0-9a-fA-F]{6}$/.test(v)) setCfg({ color: v });
                  }}
                  className="flex-1 h-6 px-1.5 text-[11px] rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </div>
            </div>
          )}
        </div>
        {/* Text-align cycle: left → center → right → left */}
        {btn(
          `Align: ${cfg.textAlign || 'left'} (click to cycle)`,
          () => {
            const cur = cfg.textAlign || 'left';
            const next = cur === 'left' ? 'center' : cur === 'center' ? 'right' : 'left';
            setCfg({ textAlign: next });
          },
          cfg.textAlign === 'center'
            ? <AlignCenter className="w-3.5 h-3.5" />
            : cfg.textAlign === 'right'
              ? <AlignRight className="w-3.5 h-3.5" />
              : <AlignLeft className="w-3.5 h-3.5" />,
        )}
      </>)}

      {/* ── IMAGE / IMAGE_CAROUSEL / LOGO ── */}
      {isImage && (<>
        {/* Replace asset — opens the AssetLibraryModal */}
        <div className="relative">
          <button
            type="button"
            aria-label="Replace image"
            title="Replace image"
            onClick={(e) => { e.stopPropagation(); setAssetOpen((v) => !v); setColorOpen(false); setUrlOpen(false); setDateOpen(false); }}
            className="w-8 h-8 rounded-md flex items-center justify-center transition-colors text-slate-600 hover:bg-slate-100"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        {/* Object-fit cycle: contain → cover → fill → contain */}
        {btn(
          `Fit: ${cfg.objectFit || cfg.fit || 'cover'} (click to cycle)`,
          () => {
            const cur = cfg.objectFit || cfg.fit || 'cover';
            const next = cur === 'cover' ? 'contain' : cur === 'contain' ? 'fill' : 'cover';
            setCfg({ objectFit: next, fit: next });
          },
          <Maximize2 className="w-3.5 h-3.5" />,
        )}
      </>)}

      {/* ── CLOCK ── */}
      {isClock && btn(
        `Format: ${cfg.format || '12h'} (click to toggle)`,
        () => setCfg({ format: cfg.format === '24h' ? '12h' : '24h' }),
        <span className="flex items-center gap-0.5">
          <Clock className="w-3 h-3" />
          <span className="text-[9px] font-bold">{cfg.format === '24h' ? '24h' : '12h'}</span>
        </span>,
      )}

      {/* ── WEATHER ── */}
      {isWeather && btn(
        `Units: ${cfg.units || 'F'} (click to toggle)`,
        () => setCfg({ units: cfg.units === 'C' ? 'F' : 'C' }),
        <span className="flex items-center gap-0.5">
          <Thermometer className="w-3 h-3" />
          <span className="text-[9px] font-bold">{cfg.units === 'C' ? 'C' : 'F'}</span>
        </span>,
      )}

      {/* ── TICKER ── */}
      {isTicker && btn(
        `Speed: ${typeof cfg.speed === 'string' ? cfg.speed : 'normal'} (click to cycle)`,
        () => {
          const cur = (typeof cfg.speed === 'string' ? cfg.speed : 'normal') as string;
          const next = cur === 'slow' ? 'normal' : cur === 'normal' ? 'fast' : 'slow';
          setCfg({ speed: next });
        },
        <span className="flex items-center gap-0.5">
          <Gauge className="w-3 h-3" />
          <span className="text-[9px] font-bold capitalize">{typeof cfg.speed === 'string' ? cfg.speed : 'N'}</span>
        </span>,
      )}

      {/* ── COUNTDOWN ── */}
      {isCountdown && (
        <div className="relative">
          <button
            type="button"
            aria-label="Set target date"
            title="Set target date"
            onClick={(e) => { e.stopPropagation(); setDateOpen((v) => !v); setColorOpen(false); setUrlOpen(false); setAssetOpen(false); }}
            className="w-8 h-8 rounded-md flex items-center justify-center transition-colors text-slate-600 hover:bg-slate-100"
          >
            <Calendar className="w-3.5 h-3.5" />
          </button>
          {dateOpen && (
            <div
              className="absolute z-40 bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-44"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Target date</label>
              <input
                type="date"
                defaultValue={cfg.targetDate || ''}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => { setCfg({ targetDate: e.target.value }); }}
                className="w-full h-7 px-2 text-xs rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
          )}
        </div>
      )}

      {/* ── WEBPAGE ── */}
      {isWebpage && (<>
        <div className="relative">
          <button
            type="button"
            aria-label="Edit URL"
            title="Edit URL"
            onClick={(e) => { e.stopPropagation(); setUrlOpen((v) => !v); setColorOpen(false); setDateOpen(false); setAssetOpen(false); }}
            className="w-8 h-8 rounded-md flex items-center justify-center transition-colors text-slate-600 hover:bg-slate-100"
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
          {urlOpen && (
            <div
              className="absolute z-40 bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-56"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Page URL</label>
              <input
                type="url"
                defaultValue={cfg.url || ''}
                placeholder="https://…"
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={(e) => { setCfg({ url: e.target.value }); }}
                className="w-full h-7 px-2 text-xs rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
          )}
        </div>
        {btn(
          cfg.staticMode ? 'Interactive: off (click to toggle)' : 'Interactive: on (click to toggle)',
          () => setCfg({ staticMode: !cfg.staticMode }),
          <MousePointer className="w-3.5 h-3.5" />,
          false,
          !cfg.staticMode,
        )}
      </>)}

      {/* Divider between type-aware and generic sections */}
      {hasTypeActions && <div className="w-px h-5 bg-slate-200 mx-0.5" />}

      {/* ── Generic actions (always visible) ── */}
      {btn('Duplicate (Ctrl/⌘+D)', () => duplicateZone(zone.id),                      <Copy className="w-3.5 h-3.5" />)}
      {btn('Bring forward',         () => moveLayer(zone.id, 'up'),                    <ChevronUp className="w-3.5 h-3.5" />)}
      {btn('Send back',             () => moveLayer(zone.id, 'down'),                  <ChevronDown className="w-3.5 h-3.5" />)}
      {btn(zone.locked ? 'Unlock' : 'Lock', () => toggleLock(zone.id),                zone.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />)}
      <div className="w-px h-5 bg-slate-200 mx-0.5" />
      {btn('Delete (Del)',          () => removeSelected(),                            <Trash2 className="w-3.5 h-3.5" />, true)}

      {/* Asset picker modal — rendered at root level so it escapes the
          floating bar stacking context. Triggered by the RefreshCw btn. */}
      {assetOpen && (
        <AssetLibraryModal
          kind="image"
          onPick={(url) => {
            // IMAGE and LOGO store their asset in assetUrl; LOGO also accepts
            // logoUrl. Use assetUrl as the canonical field to match PropertiesPanel.
            setCfg({ assetUrl: url, imageUrl: undefined });
            setAssetOpen(false);
          }}
          onClose={() => setAssetOpen(false)}
        />
      )}
    </div>
  );
}
