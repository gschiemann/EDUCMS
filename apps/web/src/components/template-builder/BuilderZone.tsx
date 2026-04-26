"use client";

import { createElement, memo, useState } from 'react';
import { Lock, Loader2, Upload } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';
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
  onConfigChange?: (zoneId: string, patch: Record<string, any>) => void;
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

function BuilderZoneImpl({ zone, selected, previewMode, onPointerDown, onResizePointerDown, onSelect, onConfigChange }: Props) {
  const color = getZoneColor(zone.widgetType);
  const icon = widgetIcon(zone.widgetType);
  const label = widgetLabel(zone.widgetType);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const supportsUpload = ['STAFF_SPOTLIGHT', 'LOGO', 'IMAGE_CAROUSEL', 'IMAGE'].includes(zone.widgetType);

  const handleDragOver = (e: React.DragEvent) => {
    if (previewMode || zone.locked || !supportsUpload || !onConfigChange) return;
    const isFile = Array.from(e.dataTransfer.types).includes('Files');
    if (isFile) {
      e.preventDefault();
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (previewMode || zone.locked || !supportsUpload || !onConfigChange) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      // Was going through a Next server action that called the API
      // without a Bearer token — API rejected the upload. Call the API
      // directly from the browser with the user's JWT instead.
      const token = useUIStore.getState().token;
      const res = await fetch(`${API_URL}/assets/upload`, {
        method: 'POST',
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const { url } = await res.json();
      
      if (zone.widgetType === 'IMAGE_CAROUSEL') {
        const existing = Array.isArray(zone.defaultConfig?.urls) ? zone.defaultConfig.urls : [];
        onConfigChange(zone.id, { urls: [...existing, url] });
      } else if (zone.widgetType === 'STAFF_SPOTLIGHT') {
        onConfigChange(zone.id, { photoUrl: url });
      } else {
        onConfigChange(zone.id, { assetUrl: url });
      }
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Failed to upload image. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(e as unknown as React.MouseEvent, zone.id);
    }
  };

  /**
   * Canva-style inline text edit. Click any [data-field] on a selected
   * zone (or double-click on any zone) and the node becomes
   * contentEditable: focused, all-text-selected, persistent indigo
   * outline. Blur or Enter commits via onConfigChange; Escape reverts.
   *
   * Also fires a `template-edit-field` CustomEvent so the
   * PropertiesPanel can scroll its matching section into view AND flash
   * it — same UX every modern design tool gives ("the toolbar follows
   * what I selected on the canvas"). Sections opt in by adding
   * `data-field-section="<key>"` to their wrapper.
   */
  const enterFieldEdit = (target: HTMLElement) => {
    if (previewMode || zone.locked || !onConfigChange) return;
    const fieldKey = target.getAttribute('data-field');
    if (!fieldKey) return;

    // Tell the PropertiesPanel to scroll + flash the matching section.
    // Both the field key as-is AND its dot-prefix (e.g. 'brand.date'
    // also flashes a section keyed on 'brand') so coarse-grained panels
    // can group multiple fields under one section.
    const dotIdx = fieldKey.indexOf('.');
    const sectionKey = dotIdx > 0 ? fieldKey.slice(0, dotIdx) : fieldKey;
    try {
      window.dispatchEvent(new CustomEvent('template-edit-field', {
        detail: { zoneId: zone.id, fieldKey, sectionKey },
      }));
    } catch { /* CustomEvent unsupported in older runtimes */ }

    target.setAttribute('contenteditable', 'true');
    // Persistent outline + glow so the operator sees what they're
    // editing, NOT just a thin caret. Higher specificity than the
    // hover style added to BuilderZone, so once edit starts, hover
    // styles don't fight the active state.
    target.style.outline = '2px solid #6366f1';
    target.style.outlineOffset = '2px';
    target.style.background = 'rgba(99,102,241,0.08)';
    target.style.borderRadius = '3px';
    target.style.cursor = 'text';
    target.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(target);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    } catch {}

    const commit = () => {
      target.removeEventListener('blur', commit);
      target.removeEventListener('keydown', onKey);
      const newValue = target.innerText.trim();
      target.removeAttribute('contenteditable');
      target.style.outline = '';
      target.style.outlineOffset = '';
      target.style.background = '';
      target.style.borderRadius = '';
      target.style.cursor = '';
      onConfigChange(zone.id, { [fieldKey]: newValue });
    };
    const cancel = () => {
      target.removeEventListener('blur', commit);
      target.removeEventListener('keydown', onKey);
      target.removeAttribute('contenteditable');
      target.style.outline = '';
      target.style.outlineOffset = '';
      target.style.background = '';
      target.style.borderRadius = '';
      target.style.cursor = '';
      target.innerText = (zone.defaultConfig as any)?.[fieldKey] ?? target.innerText;
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
    };
    target.addEventListener('blur', commit);
    target.addEventListener('keydown', onKey);
  };

  return (
    <div
      role="button"
      tabIndex={previewMode ? -1 : 0}
      aria-label={`${label} zone: ${zone.name}`}
      aria-pressed={selected}
      className="absolute group"
      style={{
        left: `${zone.x}%`,
        top: `${zone.y}%`,
        width: `${zone.width}%`,
        height: `${zone.height}%`,
        zIndex: zone.zIndex,
        // High-contrast white-on-canvas zone that's UNMISTAKABLE in
        // edit mode. Earlier attempt used `${color.bg}80` (the pale
        // pastel zone color at 50% opacity) but those pastels are
        // already #f8/#f0/#fef9 etc., so a half-opacity tint over a
        // similar-pale canvas was effectively invisible — partner
        // saw "transparent box". Now: solid white interior + 3px
        // colored border + colored corner ribbon + label badge.
        // No way for an empty zone to read as nothing.
        background: previewMode ? 'transparent' : '#ffffff',
        border: previewMode
          ? 'none'
          : (selected ? `3px dashed ${color.accent}` : `3px solid ${color.accent}`),
        boxShadow: previewMode ? undefined : `0 4px 12px ${color.accent}33`,
        outline: 'none',
        cursor: zone.locked || previewMode ? 'default' : 'move',
        userSelect: 'none',
        overflow: 'hidden',
      }}
      onPointerDown={(e) => {
        if (previewMode || zone.locked) return;
        // If the user pointer-downed on a data-field text node we
        // want to edit, do NOT start the move-drag — the dblclick
        // that follows will turn that node into an editable field.
        // Without this guard, the pointerdown captured the pointer
        // and the dblclick never fired (move-drag took priority).
        //
        // CRITICAL: stopPropagation regardless of which branch fires.
        // BuilderCanvas's onCanvasPointerDown starts a marquee-select
        // rectangle on every pointerdown that bubbles up to the canvas.
        // Without stopping the event here, clicking text on a zone:
        //   1. zone pointerdown returns early (no zone-drag) ✓
        //   2. event bubbles to canvas → marquee drag starts
        //   3. mouse moves → invisible marquee rectangle follows cursor
        //   4. user sees their click "stick to the mouse"
        // Partner reported "click to edit text → widget stuck to mouse,
        // no way to let go" — that's the marquee, not the widget.
        const target = e.target as HTMLElement | null;
        if (target?.closest?.('[data-field]')) {
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        onPointerDown(e, zone.id, 'move');
      }}
      onClick={(e) => {
        if (previewMode) return;
        e.stopPropagation();
        // If this click landed on an editable text node AND the zone
        // is already selected, jump straight into edit mode (Canva-
        // style single-click-to-edit). First click on an unselected
        // zone just selects it; the next click on a hotspot edits.
        // Without this gate, clicking on the canvas to select a zone
        // would also enter edit mode by accident.
        const fieldEl = (e.target as HTMLElement | null)?.closest?.('[data-field]') as HTMLElement | null;
        if (fieldEl && selected && onConfigChange && !zone.locked) {
          enterFieldEdit(fieldEl);
          return;
        }
        onSelect(e, zone.id);
      }}
      onDoubleClick={(e) => {
        // Double-click ALWAYS enters edit mode immediately, even on a
        // not-yet-selected zone (matches Canva/Figma where dbl-click
        // is the explicit "edit text" gesture). Falls back to the
        // single-click path's `enterFieldEdit` so visual + commit
        // behavior is identical.
        if (previewMode || zone.locked || !onConfigChange) return;
        const target = (e.target as HTMLElement | null)?.closest?.('[data-field]') as HTMLElement | null;
        if (!target) return;
        e.stopPropagation();
        e.preventDefault();
        enterFieldEdit(target);
      }}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-zone-id={zone.id}
    >
      {/* Universal text-style override. Three scopes:
            1. Per-field (cfg._styles[fieldKey]) — ONE css rule per
               styled field, scoped to [data-field="X"] inside the
               zone. Highest specificity, wins over zone-wide.
            2. Zone-wide (cfg.fontFamily / fontSize / color / bold /
               italic / underline / strikethrough) — applies to all
               text descendants of the zone. Lower specificity than
               per-field.
            3. Template-wide writes happen at the toolbar level
               (iterates every zone, writes top-level cfg keys), so
               renders identically to per-zone here.
          TEXT/RICH_TEXT widgets read from cfg directly; this block
          is a no-op there. SVG icons excluded so brand glyphs and
          lucide icons keep their intended colors. */}
      {(() => {
        const cfg = (zone.defaultConfig || {}) as any;
        if (zone.widgetType === 'TEXT' || zone.widgetType === 'RICH_TEXT') return null;

        const stylesPerField: Record<string, any> = (cfg._styles && typeof cfg._styles === 'object') ? cfg._styles : {};

        const buildRules = (s: any): string[] => {
          const rules: string[] = [];
          const fam = typeof s.fontFamily === 'string' && s.fontFamily.trim();
          const sz = typeof s.fontSize === 'number' && Number.isFinite(s.fontSize) ? s.fontSize : null;
          const col = typeof s.color === 'string' && s.color.trim();
          const decorations: string[] = [];
          if (s.underline === true) decorations.push('underline');
          if (s.strikethrough === true) decorations.push('line-through');
          if (fam) rules.push(`font-family: ${fam} !important`);
          if (sz) rules.push(`font-size: ${sz}px !important`);
          if (col) rules.push(`color: ${col} !important`);
          if (s.bold === true) rules.push(`font-weight: 800 !important`);
          if (s.italic === true) rules.push(`font-style: italic !important`);
          if (decorations.length) rules.push(`text-decoration: ${decorations.join(' ')} !important`);
          return rules;
        };

        const cssChunks: string[] = [];
        // Zone-wide first (lower specificity). Selector targets every
        // non-svg descendant of the zone.
        const zoneRules = buildRules(cfg);
        if (zoneRules.length) {
          cssChunks.push(`[data-zone-id="${zone.id}"] *:not(svg):not(svg *) { ${zoneRules.join('; ')} }`);
        }
        // Per-field rules — higher specificity (zone + field), so they
        // win over zone-wide for the targeted field.
        for (const [fieldKey, fieldStyle] of Object.entries(stylesPerField)) {
          const r = buildRules(fieldStyle);
          if (!r.length) continue;
          // CSS attribute selector escaping — field keys may include
          // dots (e.g. "agenda.0.t"). The dot inside an attribute
          // value is fine; the value just needs quoting.
          const sel = `[data-zone-id="${zone.id}"] [data-field="${fieldKey.replace(/"/g, '\\"')}"]`;
          cssChunks.push(`${sel}, ${sel} *:not(svg):not(svg *) { ${r.join('; ')} }`);
        }
        if (!cssChunks.length) return null;
        return <style>{cssChunks.join('\n')}</style>;
      })()}

      <WidgetPreview
        widgetType={zone.widgetType}
        config={zone.defaultConfig || {}}
        width={zone.width}
        height={zone.height}
        live={false}
        onConfigChange={!previewMode && onConfigChange ? (patch) => onConfigChange(zone.id, patch) : undefined}
      />

      {/* Always-visible widget-type label badge in edit mode. Lives
          in the top-left corner so freshly-dropped zones with empty
          inner widgets (image/video/logo without an asset) still
          show WHAT they are + WHERE they are. Hidden in preview
          mode + when the zone is being interacted with (so it
          doesn't obscure the actual content). */}
      {!previewMode && (
        <div
          className="absolute top-1 left-1 z-30 pointer-events-none flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider opacity-70 group-hover:opacity-100 transition-opacity"
          style={{ background: color.bg, color: color.text, border: `1px solid ${color.border}` }}
        >
          {createElement(icon, { className: 'w-2.5 h-2.5' })}
          {label}
        </div>
      )}

      {isDragOver && !previewMode && supportsUpload && (
        <div className="absolute inset-0 z-50 bg-indigo-500/20 backdrop-blur-[2px] flex items-center justify-center rounded-lg border-2 border-indigo-500 border-dashed transition-all">
          <div className="bg-indigo-600 text-white p-3 rounded-full shadow-xl animate-bounce">
            <Upload className="w-8 h-8" />
          </div>
        </div>
      )}

      {isUploading && !previewMode && (
        <div className="absolute inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex flex-col gap-2 items-center justify-center rounded-lg">
          <Loader2 className="w-8 h-8 text-white animate-spin" />
          <span className="text-white text-xs font-bold bg-slate-900/50 px-2 py-1 rounded-full">Uploading...</span>
        </div>
      )}

      {!previewMode && selected && (
        <div
          className="absolute -top-6 left-0 flex items-center gap-1 px-1.5 py-0.5 rounded-md pointer-events-none whitespace-nowrap"
          style={{ background: color.accent, color: 'white', boxShadow: '0 2px 4px rgba(0,0,0,0.15)' }}
        >
          {createElement(icon, { className: 'w-3 h-3', 'aria-hidden': true })}
          <span className="text-[9px] font-bold">{zone.name}</span>
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
      {!previewMode && !zone.locked && (
        // Inline-editable hotspot affordances. SELECTED zones get a
        // permanent dotted indigo outline on every [data-field] so the
        // operator sees "everything I can edit" at a glance — same UX
        // Canva and Figma show. Hovering bumps the outline to dashed +
        // light tint to confirm the click target. Once a node enters
        // edit mode (contentEditable=true), the inline style set by
        // enterFieldEdit takes over with a solid outline + stronger
        // tint so it's clearly the active one.
        //
        // Unselected zones DON'T show hotspots — they'd visually compete
        // with the zone's own border and overwhelm the canvas.
        <style>{`
          [data-zone-id="${zone.id}"] [data-field] {
            cursor: text;
            transition: outline 0.12s, background 0.12s;
          }
          ${selected ? `
          [data-zone-id="${zone.id}"] [data-field]:not([contenteditable="true"]) {
            outline: 1px dotted rgba(99, 102, 241, 0.55);
            outline-offset: 2px;
            border-radius: 3px;
          }
          ` : ''}
          [data-zone-id="${zone.id}"] [data-field]:not([contenteditable="true"]):hover {
            outline: 2px dashed #6366f1;
            outline-offset: 2px;
            background: rgba(99, 102, 241, 0.08);
            border-radius: 3px;
          }
        `}</style>
      )}
    </div>
  );
}

export const BuilderZone = memo(BuilderZoneImpl);
