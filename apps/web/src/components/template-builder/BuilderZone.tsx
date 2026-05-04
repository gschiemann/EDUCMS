"use client";

import { createElement, memo, useRef, useState } from 'react';
import { Lock, Loader2, Upload } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';
import type { Zone, ResizeHandle } from './types';
import { getZoneColor, widgetIcon, widgetLabel } from './constants';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';
import { WidgetErrorBoundary } from '@/components/widgets/WidgetErrorBoundary';
import { appAlert } from '@/components/ui/app-dialog';
import { useBuilderStore } from './useBuilderStore';

/**
 * setByPath — build a shallow-merge patch that updates a nested
 * dotted-key path inside `root`, preserving sibling values.
 *
 * 2026-05-03 — fixes audit P0: BuilderZone inline-edit was committing
 * `{ "schedule.0.label": "X" }` (literal flat key) for [data-field]
 * elements with dotted keys, which the renderer never read. With this
 * helper the same input becomes
 *   { schedule: [{ ...prevSchedule[0], label: "X" }, ...prevSchedule.slice(1)] }
 *
 * Pure function — no mutation of `root`. Caller passes the result as
 * the patch arg of onConfigChange (which shallow-merges into config).
 *
 * Path syntax:
 *   - Plain key            "title"          → { title: value }
 *   - Object path          "brand.color"    → { brand: { ...prev, color: value } }
 *   - Numeric array index  "schedule.0.t"   → { schedule: [{ ...prev[0], t: value }, ...prev.slice(1)] }
 *   - Mixed nested         "a.b.0.c"        → recursive
 *   - Path beyond array end pads with empty objects up to the index
 */
function setByPath(root: Record<string, any>, path: string, value: any): Record<string, any> {
  const parts = path.split('.');
  if (parts.length === 1) return { [parts[0]]: value };
  const [head, ...rest] = parts;
  const restPath = rest.join('.');
  const restHead = rest[0];
  const isArrayIndex = /^\d+$/.test(restHead);
  const existing = root?.[head];
  if (isArrayIndex) {
    const idx = parseInt(restHead, 10);
    const arr: any[] = Array.isArray(existing) ? [...existing] : [];
    while (arr.length <= idx) arr.push({});
    if (rest.length === 1) {
      arr[idx] = value;
    } else {
      const inner = arr[idx] && typeof arr[idx] === 'object' ? arr[idx] : {};
      const innerPatch = setByPath(inner, rest.slice(1).join('.'), value);
      arr[idx] = { ...inner, ...innerPatch };
    }
    return { [head]: arr };
  }
  // Object path
  const innerExisting = existing && typeof existing === 'object' ? existing : {};
  const innerPatch = setByPath(innerExisting, restPath, value);
  return { [head]: { ...innerExisting, ...innerPatch } };
}

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
  // 2026-04-29 — pointerdown movement tracking so we distinguish a
  // click (no movement → enter edit mode) from a drag (>4px movement
  // → move the widget). dragStartRef holds the pointer-down coords
  // + a flag that flips the moment movement crosses the threshold.
  // wasJustDraggedRef briefly suppresses onClick after a drag so we
  // don't also enter edit mode on a drag-end click.
  const dragStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const wasJustDraggedRef = useRef(false);
  const color = getZoneColor(zone.widgetType);
  const icon = widgetIcon(zone.widgetType);
  const label = widgetLabel(zone.widgetType);

  // 2026-04-28 — operator: 'same white background with color
  // selected'. Cause: every zone hardcoded background:'#ffffff' in
  // edit mode (line ~209), so when the operator paints a canvas
  // bg it gets covered by the placeholder zone's solid white. Fix:
  // when the canvas has ANY background set (color/gradient/image),
  // make zones transparent so the canvas bg shows through. The
  // colored 3px border + corner ribbon + label badge stay, so zones
  // remain unmistakable. When canvas is default (white), keep the
  // solid white interior so the partner's earlier fix ('saw
  // transparent box on white canvas') is preserved.
  const hasCanvasBg = useBuilderStore(
    (s) => !!(s.meta.bgColor || s.meta.bgGradient || s.meta.bgImage),
  );

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
      await appAlert({
        title: "Couldn't upload that image",
        message: 'The upload failed. Check your connection or try a smaller file (under 50 MB) and try again.',
        tone: 'danger',
      });
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
    const originalText = target.innerText;
    const pauseEl = target.closest('[data-inline-edit-pause]') as HTMLElement | null;
    const previousAnimationPlayState = pauseEl?.style.animationPlayState ?? '';
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
    // 2026-04-29 — operator: "you fucked up with editing of text on
    // the widgets... when you edit the text its transparent and you
    // cant see hwat you are typing until you click out of the text
    // field". Cause: BuilderZone's parent div has `userSelect: 'none'`
    // (line 236) which is inherited by contentEditable children.
    // userSelect: none on a contentEditable element breaks the
    // browser's live caret + selection rendering — typed characters
    // aren't repainted until the field blurs.
    //
    // Fix: explicitly override on the editing target so the
    // contentEditable behaves like a normal input — caret visible,
    // selection visible, typing repaints character-by-character.
    // Cleared in commit() / cancel() below so the parent's
    // userSelect:none returns to effect after editing.
    target.style.userSelect = 'text';
    (target.style as any).webkitUserSelect = 'text';
    (target.style as any).caretColor = 'auto';
    if (pauseEl) pauseEl.style.animationPlayState = 'paused';
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
      const newValue = target.innerText.replace(/\u00a0/g, ' ');
      target.removeAttribute('contenteditable');
      target.style.outline = '';
      target.style.outlineOffset = '';
      target.style.background = '';
      target.style.borderRadius = '';
      target.style.cursor = '';
      target.style.userSelect = '';
      (target.style as any).webkitUserSelect = '';
      (target.style as any).caretColor = '';
      if (pauseEl) pauseEl.style.animationPlayState = previousAnimationPlayState;
      // 2026-05-03 \u2014 fix audit P0: data-field writes with dotted keys
      // (e.g. `schedule.0.label`, `agenda.0.t`) must update the nested
      // location, not store a literal flat key. The previous
      // `{ [fieldKey]: newValue }` would write
      //   config["schedule.0.label"] = "Period 1"
      // which the renderer never reads (it reads config.schedule[0].label).
      // Result: silent no-op edits \u2014 operator types, sees the canvas
      // pulse, but nothing actually changes.
      //
      // setByPath() walks the dotted path on the EXISTING config and
      // returns a top-level patch with the correct nested array/object
      // shape preserved. Shallow-merge friendly (the patch's top key
      // fully replaces that subtree but with all sibling indexes /
      // properties carried through from the prior config).
      //
      // 2026-05-03 — was reading `(zone as any).config`, which is
      // ALWAYS undefined (the field is `defaultConfig`). Result: the
      // patch was built from an empty `{}` base, so an inline edit to
      // e.g. `schedule.0.label` produced
      //   { schedule: [{ label: "..." }] }
      // and the merge wiped all sibling periods (1..N) on commit.
      // Reading from `defaultConfig` preserves siblings as intended.
      const patch = setByPath((zone.defaultConfig || {}) as Record<string, any>, fieldKey, newValue);
      onConfigChange(zone.id, patch);
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
      target.style.userSelect = '';
      (target.style as any).webkitUserSelect = '';
      (target.style as any).caretColor = '';
      if (pauseEl) pauseEl.style.animationPlayState = previousAnimationPlayState;
      target.innerText = originalText;
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
        // saw "transparent box". Solid white interior + 3px
        // colored border + colored corner ribbon + label badge.
        //
        // 2026-04-28 — when the canvas has a background painted on
        // it, swap the white interior for transparent so the
        // operator's bg shows through. The colored border + label
        // badge keep zone position obvious; the white interior is
        // only needed against the default white canvas.
        background: previewMode ? 'transparent' : (hasCanvasBg ? 'transparent' : '#ffffff'),
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
        // 2026-05-03 v4 — operator: "I add a welcome message and click
        // into the text to edit, the widget gets stuck on and moves
        // everywhere I move the cursor. It should just let me edit
        // the text and not engage the moving of the widget."
        //
        // Root cause of the regression: the v3 threshold-before-drag
        // gate (added 2026-04-29) was guarded by `isTextZone` which is
        // ONLY true for widgetType === 'TEXT' || 'RICH_TEXT'. The
        // Welcome message renders as ANIMATED_WELCOME (and many other
        // widgets — Headlines, Announcements, Bell Schedules — embed
        // editable text fields too). For all those widgets the code
        // fell through to `onPointerDown(...'move')` immediately,
        // setting dragState before contentEditable could absorb the
        // pointerup → stuck-to-cursor.
        //
        // v4 — apply the threshold to ANY content-area click on ANY
        // widget. Border clicks (e.target === e.currentTarget) still
        // drag immediately so resize/move from the chrome works as
        // before. Anywhere INSIDE the widget body — including
        // [data-field] hotspots, embedded text, image captions — gets
        // the 4px threshold so contentEditable / button / input
        // children get their pointerup before drag is engaged.
        //
        //   • Click content + release (no movement) → click fires,
        //     enterFieldEdit handles inline editing. No drag.
        //   • Click content + drag >4px              → drag engages
        //     mid-gesture. wasJustDraggedRef suppresses the
        //     subsequent click→edit so a drag doesn't accidentally
        //     enter edit mode.
        //   • Click border                           → drag immediately,
        //     same as before (resize handles too).
        //   • Click [data-field] (already explicitly stopped)         → edit only.
        const target = e.target as HTMLElement | null;
        if (target?.closest?.('[data-field]')) {
          e.stopPropagation();
          return;
        }
        e.stopPropagation();

        const isContentClick = e.target !== e.currentTarget;

        // Always select the zone immediately (clicking SELECTS even
        // if no drag follows). For non-additive clicks on already-
        // selected zones, onSelect is a no-op.
        if (!selected) {
          onSelect(e as any, zone.id);
        }

        if (isContentClick) {
          // Threshold-before-drag: wait for 4px movement before
          // calling onPointerDown to set dragState. This guarantees
          // contentEditable / inputs / buttons inside the widget
          // body can absorb pointerup before drag starts —
          // eliminating the stuck-to-cursor bug for every widget,
          // not just TEXT.
          //
          // 2026-05-03 v5 — operator: chalkboard welcome (back-to-
          // school theme TEXT) STILL gets stuck to the cursor. Root
          // cause: themes/EditableText.tsx attaches its own
          // `onPointerUp` that calls `e.stopPropagation()` to keep
          // the click from bubbling to other handlers. React's
          // synthetic stopPropagation also calls
          // `nativeEvent.stopPropagation()`, so the bubble-phase
          // window listener I'd registered never fires →
          // pointermove listener never cleans up → the next cursor
          // movement crosses the 4px threshold → drag engages → "the
          // widget moves everywhere I move the cursor".
          //
          // Fix: register both window listeners in CAPTURE phase
          // (`{ capture: true }`). Capture-phase fires window → target
          // BEFORE EditableText's bubble-phase handler runs, so the
          // cleanup happens regardless of any stopPropagation
          // downstream. The 120ms wasJustDraggedRef debounce still
          // applies so a real drag still suppresses the trailing
          // click→edit.
          const startX = e.clientX;
          const startY = e.clientY;
          let dragStarted = false;
          const onMove = (ev: PointerEvent) => {
            if (dragStarted) return;
            if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) {
              dragStarted = true;
              wasJustDraggedRef.current = true;
              // Cast: BuilderCanvas's handler reads clientX/clientY +
              // shiftKey/metaKey/ctrlKey, all of which native
              // PointerEvent has. The React.PointerEvent typing is
              // overly strict here but the runtime shape works.
              onPointerDown(ev as any, zone.id, 'move');
            }
          };
          const onUp = () => {
            if (dragStarted) {
              setTimeout(() => { wasJustDraggedRef.current = false; }, 120);
            }
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', onUp, true);
            window.removeEventListener('pointercancel', onUp, true);
          };
          window.addEventListener('pointermove', onMove, true);
          window.addEventListener('pointerup', onUp, true);
          // pointercancel covers OS-level interruptions (browser tab
          // loses focus mid-gesture, touch turns into a scroll, etc.)
          // so the listeners are guaranteed to clean up.
          window.addEventListener('pointercancel', onUp, true);
          return;
        }

        // Border-click: drag immediately. No contentEditable risk
        // because the click is on the zone's chrome, not its body.
        onPointerDown(e, zone.id, 'move');
      }}
      onClick={(e) => {
        if (previewMode) return;
        e.stopPropagation();
        // 2026-04-29 v2 — if pointerdown→pointerup just included a
        // real drag (>4px movement), skip edit-mode. The click event
        // still fires after the drag's pointerup; without this guard
        // every drag would also enter edit mode at the end, which is
        // confusing.
        if (wasJustDraggedRef.current) return;
        const fieldEl = (e.target as HTMLElement | null)?.closest?.('[data-field]') as HTMLElement | null;
        const isTextZone = zone.widgetType === 'TEXT' || zone.widgetType === 'RICH_TEXT';
        const isContentClick = e.target !== e.currentTarget;
        // 2026-04-29 — Canva-style ONE-CLICK edit. Clicking a text
        // hotspot now selects + edits in a single action. The old
        // behavior required clicking once to select, THEN again to
        // edit — that ritual is exactly what the operator hated.
        if (fieldEl && onConfigChange && !zone.locked) {
          if (!selected) onSelect(e, zone.id);
          enterFieldEdit(fieldEl);
          return;
        }
        // Fallback for TEXT/RICH_TEXT widgets whose content isn't
        // wrapped in [data-field]: any content click enters edit
        // on the first available text field inside the zone.
        if (isTextZone && isContentClick && onConfigChange && !zone.locked) {
          const firstField = (e.currentTarget as HTMLElement)
            .querySelector('[data-field]') as HTMLElement | null;
          if (firstField) {
            if (!selected) onSelect(e, zone.id);
            enterFieldEdit(firstField);
            return;
          }
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
        // 2026-05-04 BUG FIX (operator screenshot AZX widget) — was
        // skipping TEXT/RICH_TEXT entirely with the rationale "TEXT
        // widgets read from cfg directly". That's true for the BARE
        // TextWidget default renderer, but false for the ~30 v2
        // themed variants (NeonMarquee, SlabHero, NewsStudioProText,
        // JumbotronProText, etc.) — those each have hardcoded styles
        // and ignore cfg.color / cfg.fontSize / cfg.bgColor. Operator
        // dropped a TEXT block, set fontSize=2 + red text + dark bg
        // and got big black text on white because a themed variant
        // was rendering. Removing the early-return makes the universal
        // !important override apply to themed TEXT renderers too — the
        // bare renderer's inline styles still apply at lower
        // specificity AND the CSS injection adds the !important fallback
        // so both paths now honor operator edits.
        // Background-color injection added below so themed renderers'
        // hardcoded bg also gets overridden.

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

        // 2026-05-04 — separate bg-color override applied to the widget-
        // content WRAPPER (not its descendants) so themed renderers'
        // wrapper bg gets overridden without painting bg on every
        // descendant span/div. Only fires when operator explicitly set
        // bgColor (not 'transparent'/empty/undefined).
        const buildBgRule = (s: any): string | null => {
          const bg = typeof s.bgColor === 'string' && s.bgColor.trim();
          if (!bg || bg === 'transparent' || bg === 'inherit') return null;
          return `background-color: ${bg} !important; background: ${bg} !important`;
        };

        const cssChunks: string[] = [];
        // 2026-05-03 — scope every font-style rule to the
        // `[data-widget-content]` wrapper instead of `[data-zone-id]`.
        // Otherwise the rules cascade to the BuilderZone chrome (the
        // tiny text-[9px] widget-type badge in the corner, the zone-
        // name pill, resize handles) and font-size !important grows
        // the badge along with the widget. Operator screenshot showed
        // a giant "SCROLLING TICKER" chip taking over the ticker row
        // because the BADGE was scaling, not the message text.
        const contentSel = `[data-zone-id="${zone.id}"] [data-widget-content]`;
        const zoneRules = buildRules(cfg);
        if (zoneRules.length) {
          cssChunks.push(`${contentSel} *:not(svg):not(svg *) { ${zoneRules.join('; ')} }`);
        }
        // 2026-05-04 — bg-color override. When operator picks a solid
        // bg in the properties panel it should override the themed
        // renderer's full visual stack: outer wrapper, every nested
        // panel (NewsStudioPro's glass-dark inner div, JumbotronPro's
        // padded inner card, RainbowRibbon's polygon SVG fill, etc.),
        // any gradients, any background-images. The operator picked a
        // solid color → they want a flat widget. Cascade aggressively
        // so the chosen color wins through every layer of decorative
        // chrome. SVG excluded so brand glyphs and icon strokes still
        // render correctly. background-image:none kills gradients;
        // background-color overrides the inline panel bg; box-shadow
        // is preserved (themed glows survive). The same rule applied
        // to descendant `*` wins specificity over each themed panel's
        // inline `style={{ background: ... }}` because of !important.
        const bgRule = buildBgRule(cfg);
        if (bgRule) {
          cssChunks.push(`${contentSel}, ${contentSel} *:not(svg):not(svg *) { ${bgRule}; background-image: none !important }`);
        }
        // Per-field rules — higher specificity (zone + field), so they
        // win over zone-wide for the targeted field.
        for (const [fieldKey, fieldStyle] of Object.entries(stylesPerField)) {
          const r = buildRules(fieldStyle);
          if (!r.length) continue;
          // CSS attribute selector escaping — field keys may include
          // dots (e.g. "agenda.0.t"). The dot inside an attribute
          // value is fine; the value just needs quoting.
          const sel = `${contentSel} [data-field="${fieldKey.replace(/"/g, '\\"')}"]`;
          cssChunks.push(`${sel}, ${sel} *:not(svg):not(svg *) { ${r.join('; ')} }`);
        }
        if (!cssChunks.length) return null;
        return <style>{cssChunks.join('\n')}</style>;
      })()}

      {/* 2026-05-03 — wrap widget render in an error boundary so a
          single buggy widget can't bubble its exception up to the
          per-tenant route boundary (`/[schoolId]/error.tsx`) and brick
          the whole CMS page.
          Also wrapped in `data-widget-content` so the universal
          text-style override above only targets the widget body, NOT
          the BuilderZone chrome (label badges, name pill above the
          zone, resize handles). Operator: "when I increase the text
          size, the SCROLLING TICKER text shows up and it's what
          increases instead of the actual scrolling text." Cause: the
          previous selector `[data-zone-id] *:not(svg):not(svg *)`
          matched the `text-[9px]` widget-type badge that lives inside
          the same zone, so font-size !important grew the badge text.
          Scoping to `[data-widget-content]` keeps chrome at its fixed
          design size and only restyles the actual widget rendering. */}
      <div data-widget-content="true" style={{ position: 'absolute', inset: 0 }}>
        <WidgetErrorBoundary resetKey={zone.id} widgetLabel={label}>
          <WidgetPreview
            widgetType={zone.widgetType}
            config={zone.defaultConfig || {}}
            width={zone.width}
            height={zone.height}
            live={false}
            onConfigChange={!previewMode && onConfigChange ? (patch) => onConfigChange(zone.id, patch) : undefined}
          />
        </WidgetErrorBoundary>
      </div>

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
          [data-zone-id="${zone.id}"] [data-widget-content] [data-field] {
            cursor: text;
            transition: outline 0.12s, background 0.12s;
          }
          ${selected ? `
          [data-zone-id="${zone.id}"] [data-widget-content] [data-field]:not([contenteditable="true"]) {
            outline: 1px dotted rgba(99, 102, 241, 0.55);
            outline-offset: 2px;
            border-radius: 3px;
          }
          ` : ''}
          [data-zone-id="${zone.id}"] [data-widget-content] [data-field]:not([contenteditable="true"]):hover {
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
