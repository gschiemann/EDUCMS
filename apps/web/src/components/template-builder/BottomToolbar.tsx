"use client";

/**
 * BottomToolbar — the Canva-style floating quick-action pill.
 *
 * Operator (2026-05-28): "Use that bottom floating toolbar to make ours
 * even better."
 *
 * When a single zone is selected this floats at bottom-center of the canvas
 * and exposes the highest-frequency edits so the operator never has to hunt
 * the right-hand Properties panel: font family, font size (− / value / +),
 * bold / italic, text colour, alignment, layer order (forward / back),
 * duplicate, and delete.
 *
 * It writes to the SAME zone config the PropertiesPanel + the existing
 * left-panel controls write to — `zone.defaultConfig.{fontFamily,fontSize,
 * bold,italic,color,textAlign}` — via updateZone(id, { defaultConfig }, …).
 * Those keys are exactly what TextWidget reads (config.content / fontSize /
 * color / alignment / bold / italic in WidgetRenderer). For non-text
 * widgets the typography controls are hidden and only the universal
 * actions (layer / duplicate / delete) show.
 *
 * Presentational + store-free for testability: the connected wrapper
 * (BottomToolbarConnected) binds it to useBuilderStore. The bare component
 * takes the selected zone + callbacks so a test can assert "size + / − and
 * the colour input fire the zone-update callback with the new value."
 *
 * NOTE: this is a NEW, focused component. It does NOT touch the existing
 * combined BuilderBottomBar (zoom / grid / undo live there). PropertiesPanel
 * is owned by another agent and is not modified.
 */

import {
  Bold, Italic, AlignLeft, AlignCenter, AlignRight,
  ChevronUp, ChevronDown, Copy, Trash2, Type as TypeIcon,
} from 'lucide-react';
import { useCallback } from 'react';
import { useBuilderStore } from './useBuilderStore';

// Curated font list — mirrors BuilderShell's BOTTOM_BAR_FONTS so the two
// toolbars offer the same families.
export const TOOLBAR_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins',
  'Oswald', 'Raleway', 'Nunito', 'Source Sans Pro', 'Playfair Display',
  'Merriweather', 'Bebas Neue', 'Caveat', 'Pacifico',
  'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New',
];

const TEXT_WIDGET_TYPES = new Set(['TEXT', 'RICH_TEXT', 'TICKER', 'ANNOUNCEMENT']);

export interface SelectedZoneLike {
  id: string;
  widgetType: string;
  defaultConfig?: Record<string, unknown> | null;
}

export interface BottomToolbarProps {
  /** The single selected zone, or null when 0 / multi selected. */
  zone: SelectedZoneLike | null;
  /** Merge a patch into the zone's defaultConfig (font, size, colour…). */
  onConfigChange: (patch: Record<string, unknown>) => void;
  onBringForward: () => void;
  onSendBack: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /**
   * Optional fallback for the size field when the zone has no explicit
   * fontSize — lets the connected wrapper feed the measured rendered px
   * so +/− steps from the design value rather than from 16. Defaults to
   * null (then the stepper anchors on 16).
   */
  measuredFontSize?: number | null;
}

export function BottomToolbar({
  zone,
  onConfigChange,
  onBringForward,
  onSendBack,
  onDuplicate,
  onDelete,
  measuredFontSize = null,
}: BottomToolbarProps) {
  if (!zone) return null;

  const cfg = (zone.defaultConfig || {}) as Record<string, any>;
  const isText = TEXT_WIDGET_TYPES.has(zone.widgetType);

  const currentSize: number =
    typeof cfg.fontSize === 'number' ? cfg.fontSize : (measuredFontSize ?? 16);
  const sizeDisplay = typeof cfg.fontSize === 'number'
    ? cfg.fontSize
    : (measuredFontSize ?? '');

  const align = (cfg.textAlign || cfg.alignment || 'left') as string;
  const setAlign = (next: string) => onConfigChange({ textAlign: next, alignment: next });

  const iconBtn = (
    label: string,
    onClick: () => void,
    icon: React.ReactNode,
    opts?: { danger?: boolean; active?: boolean },
  ) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={opts?.active || undefined}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
        opts?.danger
          ? 'text-slate-500 hover:bg-rose-50 hover:text-rose-600'
          : opts?.active
            ? 'bg-indigo-100 text-indigo-700'
            : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div
      data-testid="bottom-toolbar"
      role="toolbar"
      aria-label="Quick actions"
      /* Floats ABOVE the persistent BuilderBottomBar (zoom / grid / undo),
         which lives at bottom-3. 72px clears that bar so both pills are
         visible — this one is the on-selection Canva quick-action bar. */
      className="absolute bottom-[72px] left-1/2 -translate-x-1/2 z-30 bg-white border border-slate-200 rounded-2xl shadow-lg flex items-center gap-1 px-2 py-1.5"
    >
      {/* ── Typography (text-bearing widgets only) ───────────────────── */}
      {isText && (
        <>
          <span className="w-8 h-8 rounded-md flex items-center justify-center text-slate-400" aria-hidden>
            <TypeIcon className="w-3.5 h-3.5" />
          </span>

          <select
            aria-label="Font family"
            title="Font family"
            value={cfg.fontFamily || ''}
            onChange={(e) => onConfigChange({ fontFamily: e.target.value || undefined })}
            style={{ fontFamily: cfg.fontFamily || 'inherit' }}
            className="h-8 px-2 text-xs rounded-md bg-white border border-slate-200 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer min-w-[110px]"
          >
            <option value="">Theme font</option>
            {TOOLBAR_FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
            ))}
          </select>

          <div className="flex items-center ml-0.5">
            {iconBtn('Decrease font size', () => {
              onConfigChange({ fontSize: Math.max(8, currentSize - 2) });
            }, <span className="text-base leading-none font-semibold">−</span>)}
            <input
              type="number"
              aria-label="Font size"
              title="Font size in pixels"
              value={sizeDisplay}
              placeholder={measuredFontSize ? String(measuredFontSize) : ''}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                onConfigChange({ fontSize: Number.isFinite(v) && v > 0 ? v : undefined });
              }}
              className="h-8 w-12 px-1 text-xs text-center rounded-md bg-white border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            {iconBtn('Increase font size', () => {
              onConfigChange({ fontSize: currentSize + 2 });
            }, <span className="text-base leading-none font-semibold">+</span>)}
          </div>

          <div className="w-px h-5 bg-slate-200 mx-0.5" />

          {iconBtn('Bold', () => onConfigChange({ bold: cfg.bold !== true }),
            <Bold className="w-3.5 h-3.5" />, { active: cfg.bold === true })}
          {iconBtn('Italic', () => onConfigChange({ italic: cfg.italic !== true }),
            <Italic className="w-3.5 h-3.5" />, { active: cfg.italic === true })}

          <div className="w-px h-5 bg-slate-200 mx-0.5" />

          {/* Text colour — native colour input, value mirrors cfg.color */}
          <label
            className="relative w-8 h-8 rounded-md flex items-center justify-center cursor-pointer hover:bg-slate-100"
            title="Text color"
          >
            <span className="text-[10px] font-bold text-slate-600 leading-none">A</span>
            <span
              className="absolute bottom-1 left-1.5 right-1.5 h-1 rounded-sm border border-slate-300"
              style={{ background: cfg.color || '#1e293b' }}
            />
            <input
              type="color"
              aria-label="Text color"
              value={cfg.color || '#1e293b'}
              onChange={(e) => onConfigChange({ color: e.target.value })}
              className="absolute top-0 right-0 bottom-0 left-0 opacity-0 cursor-pointer"
            />
          </label>

          {/* Alignment — cycles left → center → right */}
          {iconBtn(
            `Align: ${align} (click to cycle)`,
            () => setAlign(align === 'left' ? 'center' : align === 'center' ? 'right' : 'left'),
            align === 'center'
              ? <AlignCenter className="w-3.5 h-3.5" />
              : align === 'right'
                ? <AlignRight className="w-3.5 h-3.5" />
                : <AlignLeft className="w-3.5 h-3.5" />,
          )}

          <div className="w-px h-5 bg-slate-300 mx-1" />
        </>
      )}

      {/* ── Universal actions (every widget) ─────────────────────────── */}
      {iconBtn('Bring forward', onBringForward, <ChevronUp className="w-3.5 h-3.5" />)}
      {iconBtn('Send back', onSendBack, <ChevronDown className="w-3.5 h-3.5" />)}
      {iconBtn('Duplicate', onDuplicate, <Copy className="w-3.5 h-3.5" />)}
      <div className="w-px h-5 bg-slate-200 mx-0.5" />
      {iconBtn('Delete', onDelete, <Trash2 className="w-3.5 h-3.5" />, { danger: true })}
    </div>
  );
}

/**
 * Connected wrapper — binds BottomToolbar to the live builder store.
 * BuilderShell mounts THIS inside the canvas column.
 */
export function BottomToolbarConnected() {
  const zones = useBuilderStore((s) => s.zones);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const previewMode = useBuilderStore((s) => s.previewMode);
  const updateZone = useBuilderStore((s) => s.updateZone);
  const duplicateZone = useBuilderStore((s) => s.duplicateZone);
  const removeSelected = useBuilderStore((s) => s.removeSelected);
  const moveLayer = useBuilderStore((s) => s.moveLayer);

  const zone = selectedIds.length === 1
    ? zones.find((z) => z.id === selectedIds[0]) ?? null
    : null;

  const onConfigChange = useCallback((patch: Record<string, unknown>) => {
    if (!zone) return;
    const existing = (zone.defaultConfig || {}) as Record<string, unknown>;
    updateZone(zone.id, { defaultConfig: { ...existing, ...patch } }, true);
  }, [zone, updateZone]);

  // Hidden in preview mode (no editing chrome on the clean preview) and
  // when not exactly one zone is selected. We render AFTER those guards so
  // the bottom-center slot is free for the existing BuilderBottomBar.
  if (previewMode || !zone) return null;

  return (
    <BottomToolbar
      zone={zone}
      onConfigChange={onConfigChange}
      onBringForward={() => moveLayer(zone.id, 'up')}
      onSendBack={() => moveLayer(zone.id, 'down')}
      onDuplicate={() => duplicateZone(zone.id)}
      onDelete={() => removeSelected()}
    />
  );
}
