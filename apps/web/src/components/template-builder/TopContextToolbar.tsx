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

  // Empty state: no selection, multi-select, or non-text type.
  if (previewMode) return null;
  if (selectedIds.length !== 1) return <ToolbarShell empty />;
  const zone = zones.find((z) => z.id === selectedIds[0]);
  if (!zone) return <ToolbarShell empty />;
  const isText = zone.widgetType === 'TEXT' || zone.widgetType === 'RICH_TEXT';
  if (!isText) return <ToolbarShell empty />;

  const cfg = (zone.defaultConfig || {}) as any;
  const setField = (patch: Record<string, any>) =>
    updateZone(zone.id, { defaultConfig: { ...cfg, ...patch } }, true);

  return (
    <ToolbarShell>
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
        <div className="ml-auto self-center text-[10px] text-slate-400 font-medium pb-1">
          Editing <span className="text-slate-700 font-bold">{zone.name}</span> · more options in <span className="text-indigo-600 font-bold">Properties</span> panel
        </div>
      </div>
    </ToolbarShell>
  );
}

/** Shell wrapper. When `empty=true` renders a thin neutral strip with
 *  a subtle "no selection" hint, so the editor's vertical rhythm
 *  doesn't shift when you click between selections. */
function ToolbarShell({ empty, children }: { empty?: boolean; children?: React.ReactNode }) {
  return (
    <div
      className={`shrink-0 border-b border-slate-200 bg-white/80 backdrop-blur-sm px-4 ${
        empty ? 'py-2' : 'py-3'
      }`}
      role="toolbar"
      aria-label="Selection-context toolbar"
    >
      {empty ? (
        <p className="text-[10px] text-slate-400 font-medium">
          Select a text widget to format, or use the Properties panel for richer controls.
        </p>
      ) : (
        children
      )}
    </div>
  );
}
