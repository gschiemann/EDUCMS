"use client";

/**
 * TopContextToolbar — A1 of the Canva parity sweep (scoped MVP).
 *
 * Sits between the BuilderToolbar (Save/Discard) and the canvas.
 * When ONE TEXT/RICH_TEXT zone is selected, surfaces the same font /
 * size / color / B-I-U-S controls that live in the side Properties
 * panel — but at the TOP of the canvas where Canva trains operators
 * to look for them. No tab switch, no panel scrolling.
 *
 * For other widget types and multi-select the toolbar is hidden
 * (they fall through to the side panel where rich per-widget editors
 * live). Future scope: add image / shape / web-page contextual rows.
 *
 * The controls are mirrored from PropertiesPanel — same Zustand
 * actions, same store reads, so editing here vs there is
 * indistinguishable. No new state.
 */

import { useEffect } from 'react';
import { useBuilderStore } from './useBuilderStore';
import {
  FontFamilyField,
  FontSizeField,
  FormatToggles,
  ColorField,
} from './PropertiesPanel';

export function TopContextToolbar() {
  const zones        = useBuilderStore((s) => s.zones);
  const selectedIds  = useBuilderStore((s) => s.selectedIds);
  const updateZone   = useBuilderStore((s) => s.updateZone);
  const previewMode  = useBuilderStore((s) => s.previewMode);

  const zone = selectedIds.length === 1 ? zones.find((z) => z.id === selectedIds[0]) : undefined;
  const isText  = zone?.widgetType === 'TEXT' || zone?.widgetType === 'RICH_TEXT';
  const isImage = zone?.widgetType === 'IMAGE' || zone?.widgetType === 'IMAGE_CAROUSEL' || zone?.widgetType === 'LOGO' || zone?.widgetType === 'STAFF_SPOTLIGHT';
  const cfg = (zone?.defaultConfig || {}) as any;
  const setField = (patch: Record<string, any>) => {
    if (!zone) return;
    updateZone(zone.id, { defaultConfig: { ...cfg, ...patch } }, true);
  };

  // Cmd+B / Cmd+I / Cmd+U / Cmd+Shift+X — text format keyboard
  // shortcuts. Canva-standard. Active only when a text widget is
  // selected so they don't fight other Cmd+B handlers (browser back
  // would also be on Cmd+B in some shells; we e.preventDefault so
  // the browser default doesn't fire).
  useEffect(() => {
    if (!isText || !zone) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName) || t?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); setField({ bold: cfg.bold !== true }); }
      else if (k === 'i') { e.preventDefault(); setField({ italic: cfg.italic !== true }); }
      else if (k === 'u') { e.preventDefault(); setField({ underline: cfg.underline !== true }); }
      else if (e.shiftKey && k === 'x') { e.preventDefault(); setField({ strikethrough: cfg.strikethrough !== true }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isText, zone?.id, cfg.bold, cfg.italic, cfg.underline, cfg.strikethrough]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide entirely in previewMode, on no selection, multi-select, or
  // a widget type with no contextual controls. No empty-chrome strip
  // — fewer pixels of noise > "always-visible" consistency.
  if (previewMode) return null;
  if (!zone) return null;
  if (!isText && !isImage) return null;

  return (
    <div
      className="shrink-0 border-b border-slate-200 bg-white/80 backdrop-blur-sm px-4 py-3"
      role="toolbar"
      aria-label="Selection-context toolbar"
    >
      {isText && (
        <div className="flex items-end gap-3 flex-wrap">
          <div className="min-w-[180px]">
            <FontFamilyField
              label="Font"
              value={cfg.fontFamily || ''}
              onChange={(v) => setField({ fontFamily: v })}
            />
          </div>
          <div>
            <FontSizeField
              label="Size"
              value={cfg.fontSize ?? null}
              onChange={(v) => setField({ fontSize: v })}
            />
          </div>
          <div className="min-w-[200px]">
            <FormatToggles
              bold={cfg.bold === true}
              italic={cfg.italic === true}
              underline={cfg.underline === true}
              strikethrough={cfg.strikethrough === true}
              onChange={(patch) => setField(patch)}
            />
          </div>
          <div className="min-w-[180px]">
            <ColorField
              label="Color"
              value={cfg.color || '#1e293b'}
              onChange={(v) => setField({ color: v })}
            />
          </div>
        </div>
      )}
      {isImage && (
        <div className="flex items-end gap-3 flex-wrap">
          {/* Fit toggles — match background-size CSS values. */}
          <div className="min-w-[180px]">
            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Fit</label>
            <div className="flex gap-1">
              {(['cover', 'contain'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setField({ fit: opt })}
                  className={`flex-1 h-9 rounded-lg text-xs font-bold transition-colors border shadow-sm ${
                    (cfg.fit || 'cover') === opt
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-slate-200/60 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {opt === 'cover' ? 'Fill' : 'Fit'}
                </button>
              ))}
            </div>
          </div>
          {/* Opacity 0-100. */}
          <div className="min-w-[180px]">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-semibold text-slate-500">Opacity</label>
              <span className="text-[10px] font-mono text-slate-500">{Math.round((cfg.opacity ?? 1) * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={cfg.opacity ?? 1}
              onChange={(e) => setField({ opacity: parseFloat(e.target.value) })}
              aria-label="Image opacity"
              className="w-full accent-indigo-600"
            />
          </div>
          {/* Corner radius slider — pure CSS, doesn't touch the asset. */}
          <div className="min-w-[180px]">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-semibold text-slate-500">Corner radius</label>
              <span className="text-[10px] font-mono text-slate-500">{cfg.borderRadius ?? 0}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={64}
              step={1}
              value={cfg.borderRadius ?? 0}
              onChange={(e) => setField({ borderRadius: parseInt(e.target.value, 10) })}
              aria-label="Corner radius"
              className="w-full accent-indigo-600"
            />
          </div>
        </div>
      )}
    </div>
  );
}
