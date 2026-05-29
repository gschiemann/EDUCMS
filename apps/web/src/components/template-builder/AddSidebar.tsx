"use client";

/**
 * AddSidebar — the Canva-style left "Add" rail.
 *
 * Operator (2026-05-28): "Use the left side toolbar where I can add in
 * actual photos, URLs, things like that."
 *
 * This is a thin, high-frequency INSERT surface: Add Text, Image, Video,
 * Webpage/URL embed, QR, and a Shape/color block. Every button drops a
 * real zone onto the canvas via the store's `addZone(widgetType)` path —
 * the SAME path VariantPicker.handlePick + BuilderShell.handleDragEnd use
 * (see useBuilderStore.addZone, which seeds a sensible defaultConfig per
 * type and auto-selects the new zone). Photos/videos route through the
 * shared AssetLibraryModal (the exact picker PropertiesPanel + the bottom
 * bar use), so "add a photo from my PC" and "pick from the library" both
 * work, and the asset URL lands on the new zone's `config.assetUrl` — the
 * key ImageWidget / VideoWidget / LogoWidget actually read.
 *
 * It does NOT replace the full Widget Library (VariantPicker) — that's the
 * "browse every themed variant" surface. This rail is the fast path for the
 * five things operators reach for constantly.
 *
 * Mounting: rendered as a vertical rail to the LEFT of the existing tabbed
 * panel in BuilderShell. Kept intentionally narrow so the 420px tools panel
 * is untouched.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Type, Image as ImageIcon, Video, Globe, QrCode, Square as SquareIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import { AssetLibraryModal } from './PropertiesPanel';

/**
 * Insert a content zone. `onInsert` is injected so the component is
 * trivially testable (the test passes a spy and asserts the right
 * widgetType + post-insert config patch). In the live app BuilderShell
 * wires this to the store's addZone (+ updateZone for the asset URL).
 */
export interface AddSidebarProps {
  /**
   * Insert a new zone of `widgetType` and return its id. Mirrors
   * useBuilderStore.addZone (which auto-selects + seeds defaults).
   */
  onInsert: (widgetType: string) => string;
  /**
   * Merge a config patch into a zone AFTER insert — used to drop the
   * picked asset URL onto a freshly-added IMAGE / VIDEO zone, or to
   * stamp the Shape colour block. Must MERGE over the store's per-type
   * seed, not replace it. Mirrors the connected container's
   * updateZone-with-merged-defaultConfig wiring.
   */
  onSetConfig: (zoneId: string, patch: Record<string, unknown>) => void;
  /** Test seam — defaults to the real shared AssetLibraryModal. */
  AssetPicker?: typeof AssetLibraryModal;
}

type AddItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Plain INSERT items just drop a widget. */
  widgetType?: string;
  /** Optional config patch applied to the freshly-dropped zone (merged
   *  over the store's per-type seed). Used by "Shape" to make a TEXT
   *  zone render as a solid colour block. */
  seed?: Record<string, unknown>;
  /** Media items open the asset picker first, then drop + set assetUrl. */
  media?: 'image' | 'video';
};

// The six high-frequency inserts. Order = operator priority: text + photo
// first (the two most-reached-for), then video / link / QR / shape.
//
// Widget-type choices map to real renderers + real store seeds:
//   TEXT     → TextWidget (config.content)
//   IMAGE    → ImageWidget (config.assetUrl)        [via asset picker]
//   VIDEO    → VideoWidget (config.assetUrl)        [via asset picker]
//   WEBPAGE  → WebpageWidget (config.url)
//   TOUCH_QR → canonicalises to TOUCH_POINT variant='qr' → real QrCodeVariant
//   Shape    → a TEXT zone with empty content + solid bgColor renders as a
//              filled colour block (TextWidget reads config.bgColor). There
//              is no standalone SHAPE widget, so we lean on TEXT's bg — an
//              honest, visible primitive the operator can recolour + resize.
const ADD_ITEMS: AddItem[] = [
  { id: 'text',  label: 'Text',    icon: Type,      widgetType: 'TEXT' },
  { id: 'image', label: 'Image',   icon: ImageIcon, media: 'image' },
  { id: 'video', label: 'Video',   icon: Video,     media: 'video' },
  { id: 'url',   label: 'Webpage', icon: Globe,     widgetType: 'WEBPAGE' },
  { id: 'qr',    label: 'QR code', icon: QrCode,    widgetType: 'TOUCH_QR' },
  { id: 'shape', label: 'Shape',   icon: SquareIcon, widgetType: 'TEXT', seed: { content: '', bgColor: '#6366f1' } },
];

export function AddSidebar({ onInsert, onSetConfig, AssetPicker = AssetLibraryModal }: AddSidebarProps) {
  // When a media tile is clicked we open the shared asset picker; on pick
  // we insert the right widget and stamp the asset URL onto it.
  const [pickerKind, setPickerKind] = useState<'image' | 'video' | null>(null);

  const handleInsert = useCallback((item: AddItem) => {
    if (!item.widgetType) return;
    const id = onInsert(item.widgetType);
    if (item.seed) onSetConfig(id, item.seed);
  }, [onInsert, onSetConfig]);

  const handleMediaPick = useCallback((url: string) => {
    if (!pickerKind) return;
    // IMAGE / VIDEO widgets both read `config.assetUrl` (see
    // WidgetRenderer's ImageWidget/VideoWidget). Insert the zone, then
    // patch its config so the picked asset is visible immediately.
    const widgetType = pickerKind === 'image' ? 'IMAGE' : 'VIDEO';
    const id = onInsert(widgetType);
    onSetConfig(id, { assetUrl: url });
    setPickerKind(null);
  }, [pickerKind, onInsert, onSetConfig]);

  return (
    <aside
      className="w-[88px] bg-white/70 backdrop-blur-2xl border-r border-slate-200/50 flex flex-col items-center py-3 shrink-0 z-10"
      aria-label="Add content"
    >
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2 select-none">Add</div>
      <div className="flex flex-col gap-1.5 w-full px-2">
        {ADD_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`add-${item.id}`}
              aria-label={`Add ${item.label}`}
              title={`Add ${item.label}`}
              onClick={() => {
                if (item.media) {
                  setPickerKind(item.media);
                } else {
                  handleInsert(item);
                }
              }}
              className="group flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-indigo-50/70 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <span className="w-9 h-9 rounded-lg bg-white ring-1 ring-slate-200/70 group-hover:ring-indigo-200 shadow-sm flex items-center justify-center transition-colors">
                <Icon className="w-[18px] h-[18px]" aria-hidden />
              </span>
              <span className="text-[10px] font-semibold leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Shared asset picker — same modal PropertiesPanel + the bottom bar
          use. Supports library pick AND upload-from-PC. */}
      {pickerKind && (
        <AssetPicker
          kind={pickerKind}
          onPick={handleMediaPick}
          onClose={() => setPickerKind(null)}
        />
      )}
    </aside>
  );
}

/**
 * Container that binds AddSidebar to the live builder store. BuilderShell
 * mounts THIS (so the presentational AddSidebar stays store-free + testable).
 */
export function AddSidebarConnected() {
  const addZone = useBuilderStore((s) => s.addZone);
  const updateZone = useBuilderStore((s) => s.updateZone);

  // Stable refs so the props passed to AddSidebar don't churn every render.
  const addZoneRef = useRef(addZone);
  const updateZoneRef = useRef(updateZone);
  useEffect(() => { addZoneRef.current = addZone; }, [addZone]);
  useEffect(() => { updateZoneRef.current = updateZone; }, [updateZone]);

  const onInsert = useCallback((widgetType: string) => addZoneRef.current(widgetType), []);
  const onSetConfig = useCallback((zoneId: string, patch: Record<string, unknown>) => {
    // MERGE over the store's per-type seed (e.g. don't drop a QR's
    // variant when stamping a value). commit=true so the asset drop /
    // shape recolour is a single undoable step.
    const zone = useBuilderStore.getState().zones.find((z) => z.id === zoneId);
    const existing = (zone?.defaultConfig || {}) as Record<string, unknown>;
    updateZoneRef.current(zoneId, { defaultConfig: { ...existing, ...patch } }, true);
  }, []);

  return <AddSidebar onInsert={onInsert} onSetConfig={onSetConfig} />;
}
