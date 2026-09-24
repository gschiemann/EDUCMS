"use client";

import { createElement, memo, useRef, useState } from 'react';
import { Lock, Loader2, Upload, Hand } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';
import type { Zone, ResizeHandle } from './types';
import { getZoneColor, widgetIcon, widgetLabel } from './constants';
import { isFullCanvasExternalZone } from './SelectionChrome';
import dynamic from 'next/dynamic';

// Bundle-split step 2 (2026-07-20): WidgetRenderer is the widget world —
// a ~3.4 MB chunk when bundled statically. Load it on demand so this
// dashboard surface's first paint doesn't parse every widget theme. Same
// pattern as ScaledTemplateThumbnail (the repo's blessed dynamic mount).
// Player + board routes intentionally keep STATIC imports (offline
// life-safety rendering must never wait on a lazy chunk).
const WidgetPreview = dynamic(
  () => import('@/components/widgets/WidgetRenderer').then((m) => ({ default: m.WidgetPreview })),
  { ssr: false, loading: () => null },
);
import { WidgetErrorBoundary } from '@/components/widgets/WidgetErrorBoundary';
import { buildTextStyleRules, buildFieldOnlyStyleRules } from '@/components/widgets/text-style-contract';
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


// Phase D2.8 — TOUCH_POINT zones are the canonical interactive
// widget. Phase D2.9 + D2.10 added 14 visual variants on top of the
// original transparent "hotspot" — circles, arrows, kiosk nav
// buttons (home/back/next/close/menu/help/play), etc.
//
// In the builder we differentiate:
//   - INVISIBLE variant ('hotspot' or no variant): widget renders
//     null at runtime, so the editor draws a dashed overlay + a
//     centered "Tap target / Set Tap Action" hint badge so the
//     operator can still see and position it.
//   - VISIBLE variants (everything else): the widget paints its
//     own button. The editor shows a small corner Hand badge with
//     the assigned action type — same affordance as a tap action
//     on a regular content zone.
const isTouchPointType = (w: string) => w === 'TOUCH_POINT';
const isInvisibleTouchVariant = (z: Zone) => {
  if (z.widgetType !== 'TOUCH_POINT') return false;
  let v = String((z.defaultConfig as any)?.variant || 'hotspot').toLowerCase();
  // Strip the V2 picker's 'touch-' namespace prefix so 'touch-hotspot'
  // and 'hotspot' both resolve to the same invisible-overlay branch.
  if (v.startsWith('touch-')) v = v.slice('touch-'.length);
  return v === 'hotspot' || v === '';
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
  const isTouchPoint = isTouchPointType(zone.widgetType);
  const isHotspotVariant = isInvisibleTouchVariant(zone);

  // 2026-06-01 — a full-bleed EXTERNAL_HTML zone (a self-contained signage
  // template that IS the whole board, e.g. the Domino's pizza board) needs
  // NO zone chrome. There's no sibling to select, so the 2px selection ring
  // (offset +2, just OUTSIDE the canvas edge) merely doubles the canvas
  // frame border — exactly the operator's "your highlights are double
  // circling areas" report. Resize handles on a 100%×100% zone are equally
  // meaningless. Editing happens entirely through the Properties panel's
  // field list (click a field row → it flashes in the iframe via the
  // educms-highlight bridge), so suppressing the ring + handles here removes
  // the redundant double-outline without losing any affordance.
  const isFullCanvasExternal = isFullCanvasExternalZone(zone);

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
        message: 'The upload failed. Check your connection or try a smaller file (under 500 MB) and try again.',
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
    // `data-field-jump` = "this text on the canvas is backed by a field, but it
    // is NOT safe to type over in place" (2026-09-11). A TICKER renders
    // `config.messages.join(' ★ ')` and a LUNCH_MENU renders a list of item
    // objects; committing a contenteditable here would write one flat STRING
    // over the array and destroy every row. Those widgets used to carry no
    // hotspot at all, so their text looked dead on the canvas — measured: 4 of
    // the 12 widgets the picker recommends first. Now the click routes to the
    // real list editor instead of pretending to be an inline edit.
    const jumpKey = target.getAttribute('data-field-jump');
    const fieldKey = target.getAttribute('data-field');
    if (jumpKey) {
      const jDot = jumpKey.indexOf('.');
      try {
        window.dispatchEvent(new CustomEvent('template-edit-field', {
          detail: { zoneId: zone.id, fieldKey: jumpKey, sectionKey: jDot > 0 ? jumpKey.slice(0, jDot) : jumpKey },
        }));
      } catch { /* CustomEvent unsupported in older runtimes */ }
      return;
    }
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
        // ALWAYS the zone's own stacking order — never hoisted on selection.
        // Until 2026-09-13 a selected zone jumped to zIndex 1000 so its ring
        // stayed visible over overlapping zones; that put a selected FULL-SCREEN
        // zone (the filled placeholder, a hero photo, a background video) above
        // every widget on top of it, so clicking the background made the rest of
        // the board vanish. The ring + handles now live in SelectionChrome
        // (BuilderCanvas), a top-layer overlay that never moves the content.
        zIndex: zone.zIndex,
        // 2026-05-28 (§19) — zone rotation + opacity, edited in the
        // "Position & size" panel and stored under
        // defaultConfig._zoneRotation / _zoneOpacity. Applied identically
        // here and on the player (apps/web/src/app/player/page.tsx) so the
        // builder is WYSIWYG. `transform: rotate()` + `opacity` are both
        // Chromium-83-safe (predate the Taurus's Chrome 83 by years); no
        // `inset`. Omitted entirely when unset/identity so 99% of zones
        // get no extra transform.
        ...(() => {
          const c = (zone.defaultConfig || {}) as Record<string, unknown>;
          const rot = typeof c._zoneRotation === 'number' ? c._zoneRotation : 0;
          const opa = typeof c._zoneOpacity === 'number' ? c._zoneOpacity : 1;
          const extra: React.CSSProperties = {};
          if (rot) extra.transform = `rotate(${rot}deg)`;
          if (opa < 1) extra.opacity = opa;
          return extra;
        })(),
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
        // Phase D2.8/D2.9 — TOUCH_POINT styling. Two sub-styles:
        //   - Invisible hotspot variant: dashed overlay + faint tint
        //     so the operator can see and position what would
        //     otherwise be totally transparent at runtime.
        //   - Visible variant (arrow/circle/home/menu/etc.): the
        //     widget paints its own button. Editor chrome stays
        //     minimal (transparent fill, selection-only border)
        //     so the touch-point visual isn't obscured.
        // 2026-05-30 — operator: "only put a visible box around it when I
        // select it." Unselected content zones now render CLEAN — no white
        // fill, no border, no glow. The white interior is kept only for a
        // SELECTED empty zone on a default (white) canvas so it's visible
        // while editing. Hover reveals a subtle outline + the label badge
        // (see the <style> + badge blocks) so zones stay findable.
        background: isHotspotVariant
          ? (previewMode ? 'transparent' : 'rgba(124, 58, 237, 0.06)')
          : (isTouchPoint
              ? 'transparent'
              : (previewMode ? 'transparent' : (!hasCanvasBg && selected ? '#ffffff' : 'transparent'))),
        border: previewMode
          ? 'none'
          : (isHotspotVariant
              ? '3px dashed var(--brand-primary, #7c3aed)'
              : (isTouchPoint
                  ? (selected ? '2px dashed var(--brand-primary, #7c3aed)' : 'none')
                  // 2026-05-30 — operator: "when I select the box it reduces the
                  // font size." Cause: a border on the SELECTED zone shrinks the
                  // content box (box-sizing: border-box → the absolutely-positioned
                  // data-widget-content child insets by the border width), so
                  // FitOneLine/FitBox re-measure a smaller area and scale the text
                  // DOWN the moment you select. Content zones now carry NO border
                  // in either state — the selection box is the `outline` below,
                  // which has ZERO layout impact, so selecting never resizes the
                  // widget.
                  : 'none')),
        // No always-on glow — the clean selection outline below is the only
        // box affordance; unselected zones get nothing (hover excepted).
        boxShadow: undefined,
        // 2026-05-29 — operator wants a SIMPLE outline on the clicked element,
        // not a big glow/banner: a clean 2px indigo ring marks what's selected.
        outline: selected && !previewMode && !isFullCanvasExternal ? '2px solid #6366f1' : 'none',
        outlineOffset: selected && !previewMode && !isFullCanvasExternal ? 2 : 0,
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
        //   • Click [data-field] / [data-field-jump] → edit / jump (onClick);
        //     press + travel >4px on an IDLE hotspot  → drag, like any content
        //     (2026-09-13). Only an ACTIVE contenteditable field is edit-only.
        const target = e.target as HTMLElement | null;
        const hotspot = target?.closest?.('[data-field],[data-field-jump]') as HTMLElement | null;
        // 2026-09-13 (template-maker audit) — a hotspot press is edit-only ONLY
        // while that field is actually being edited (contenteditable armed by
        // enterFieldEdit): a press-and-move there must select text, never move
        // the zone. An IDLE hotspot falls through to the same threshold path as
        // any other content click — a clean click still edits / jumps (onClick
        // below), a press that travels 4px drags. Before this, every widget
        // whose whole body is a hotspot (tickers, calendars, rich text, most
        // list boards — 100% on the drag-surface sweep) could not be moved with
        // the mouse at all: grabbing a calendar opened its list editor instead.
        if (hotspot && hotspot.isContentEditable) {
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
        const fieldEl = (e.target as HTMLElement | null)?.closest?.('[data-field],[data-field-jump]') as HTMLElement | null;
        const isTextZone = zone.widgetType === 'TEXT' || zone.widgetType === 'RICH_TEXT';
        const isContentClick = e.target !== e.currentTarget;
        // 2026-04-29 — Canva-style ONE-CLICK edit. Clicking a text
        // hotspot now selects + edits in a single action. The old
        // behavior required clicking once to select, THEN again to
        // edit — that ritual is exactly what the operator hated.
        if (fieldEl && onConfigChange && !zone.locked) {
          // ALWAYS select, even when this zone is already selected
          // (2026-09-11). Selecting is what opens the Properties rail, and
          // both hotspot paths depend on that rail being mounted: the inline
          // path scrolls + flashes the matching section, and `data-field-jump`
          // has nothing BUT that jump. Guarding on `!selected` meant clicking
          // text on an already-selected zone dispatched into a panel that was
          // not on screen, so the click looked like it did nothing at all.
          onSelect(e, zone.id);
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
            onSelect(e, zone.id);   // see the note above — the rail must be open
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
        const target = (e.target as HTMLElement | null)?.closest?.('[data-field],[data-field-jump]') as HTMLElement | null;
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

        // 2026-09-12 (M0-3) — these two used to be local closures here, a
        // near-duplicate lived in the player, and the EXTERNAL_HTML sender
        // had no translation at all, which is how Bold could light up in
        // the builder and do nothing on 250 packaged boards. All three now
        // derive from ONE contract so they cannot drift again:
        // `@/components/widgets/text-style-contract`.
        //
        // Output is byte-identical to the closures this replaced (same
        // declarations, same order, same trimming) — locked by
        // `text-style-contract.test.ts`. Color still accepts a literal
        // (#hex / rgb()) OR a brand token the bottom bar writes as
        // `var(--brand-primary)` / `var(--brand-accent)`, which resolve
        // against the per-template canvas vars so a rebrand live-updates.
        // One behaviour change, strictly safer: a null `_styles[key]` used
        // to THROW here (the player's copy carried an explicit null guard
        // and this one did not) and now yields no rules.
        const buildRules = buildTextStyleRules;

        // Element-level controls must target the field itself only. Applying
        // a background or display rule to every descendant would paint each
        // nested span separately or hide unrelated inner structure.
        const buildFieldOnlyRules = buildFieldOnlyStyleRules;

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
          const fieldOnly = buildFieldOnlyRules(fieldStyle);
          if (!r.length && !fieldOnly.length) continue;
          // CSS attribute selector escaping — field keys may include
          // dots (e.g. "agenda.0.t"). The dot inside an attribute
          // value is fine; the value just needs quoting.
          const sel = `${contentSel} [data-field="${fieldKey.replace(/"/g, '\\"')}"]`;
          if (r.length) cssChunks.push(`${sel}, ${sel} *:not(svg):not(svg *) { ${r.join('; ')} }`);
          if (fieldOnly.length) cssChunks.push(`${sel} { ${fieldOnly.join('; ')} }`);
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
      <div data-widget-content="true" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
        <WidgetErrorBoundary resetKey={zone.id} widgetLabel={label}>
          {/* 2026-05-17 — celebration widgets are motion-first (sparkle
              bursts, stadium-light shake, ribbon sweep). A frozen
              preview reads as "broken" to the operator who's wiring a
              touchdown cue to the ribbon + scoreboard. Run their
              animations in the builder. Safe: celebration widgets do
              ZERO data-fetching — `live` only gates their CSS
              keyframes. Data-driven widgets (SCOREBOARD polls
              /sports/board/:id, WEATHER fetches) stay `live={false}`
              so the builder never hammers an API. */}
          <WidgetPreview
            widgetType={zone.widgetType}
            config={zone.defaultConfig || {}}
            width={zone.width}
            height={zone.height}
            live={zone.widgetType === 'CELEBRATION' || String((zone.defaultConfig || {}).variant || '').startsWith('cel-')}
            onConfigChange={!previewMode && onConfigChange ? (patch) => onConfigChange(zone.id, patch) : undefined}
          />
        </WidgetErrorBoundary>
      </div>

      {/* Always-visible widget-type label badge in edit mode. Lives
          in the top-left corner so freshly-dropped zones with empty
          inner widgets (image/video/logo without an asset) still
          show WHAT they are + WHERE they are. Hidden in preview
          mode + when the zone is being interacted with (so it
          doesn't obscure the actual content).

          Phase D2.8 — TOUCH_POINT zones use a centered "Tap target"
          label instead of a corner badge. The whole zone is the
          tap region so the label belongs in the middle — and it
          uses the brand-primary color to match the dashed border.
          When a tap action is set, we show its type ("goto-scene",
          "open-url", ...) so operators audit at a glance. */}
      {/* Phase D2.9 — invisible hotspot variant gets the centered
          "Tap target / Set Tap Action" overlay so the operator can
          see + audit what's otherwise invisible. Visible touch
          variants render their own button via WidgetPreview, so
          they fall through to the standard corner-badge affordance
          (same as a regular content zone with a touchAction set). */}
      {!previewMode && isHotspotVariant && (
        <div className="absolute inset-0 z-30 pointer-events-none flex flex-col items-center justify-center text-center">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: 'var(--brand-primary, #7c3aed)',
              color: 'white',
              boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
            }}
          >
            <Hand className="w-3 h-3" aria-hidden />
            {zone.touchAction ? zone.touchAction.type : 'Tap target'}
          </div>
          {!zone.touchAction && (
            <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--brand-primary, #7c3aed)' }}>
              Set Tap Action →
            </p>
          )}
        </div>
      )}
      {/* 2026-05-30 — operator: "I would dump those grey tag names all
          together." The grey widget-type corner chip (CLOCK / SCOREBOARD /
          SCORE_HOME …) is GONE — it cluttered the canvas, overlapped widget
          content (a "SCOREBOARD" chip sat on top of the team name), and the
          widgetType label didn't even match what the operator was editing.
          What a zone is now lives ONLY in the Properties panel header. The
          on-canvas selection affordance is the clean outline + resize handles
          (no text label). */}

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

      {/* Phase D2.6 — touch-action affordance. When a zone has a tap
          action assigned, surface a small Hand badge so the operator
          can audit interactivity from the canvas without opening the
          properties panel. Hidden in preview mode; positioned right
          of the lock icon so they don't collide.

          UX audit 2026-05-12 (C1) — small zones can't fit the full
          action-type label ("goto-template") and the chip used to
          overflow. Two-tier render: tiny zones get an icon-only
          badge with the type in tooltip; larger zones get the
          short type label clipped at max-width with truncate.

          Phase D2.8 — invisible hotspot variants render their own
          centered Hand badge above (see the isHotspotVariant block),
          so skip the corner badge there to avoid duplicating it.
          Visible touch variants get the corner badge like any
          regular zone with a touchAction. */}
      {!previewMode && !isHotspotVariant && zone.touchAction && (() => {
        const isTiny = zone.width < 15 || zone.height < 15;
        const actionType = zone.touchAction.type;
        return (
          <div
            className={`absolute right-1 z-30 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider opacity-80 group-hover:opacity-100 transition-opacity pointer-events-none ${isTiny ? '' : 'max-w-[80px]'}`}
            style={{
              background: 'var(--brand-primary, #6366f1)',
              color: 'white',
              boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
              // Nudge down when both lock + touch badges are present so
              // they stack instead of overlapping.
              top: zone.locked ? '1.75rem' : '0.25rem',
            }}
            aria-label={`Touch action: ${actionType}`}
            title={`Tap action: ${actionType}`}
          >
            <Hand className="w-2.5 h-2.5 shrink-0" aria-hidden />
            {!isTiny && (
              <span className="truncate">{actionType}</span>
            )}
          </div>
        );
      })()}

      {/* Resize handles: SelectionChrome (BuilderCanvas) draws them above every zone. */}
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
          ${!selected ? `
          /* 2026-05-30 — unselected zones have NO persistent box. A subtle
             accent outline appears only on hover so the operator can still
             find + click a zone. outline-offset:-2px keeps it inside the
             zone edge (no layout shift, Chromium-83-safe — no inset/gap). */
          [data-zone-id="${zone.id}"]:hover {
            outline: 2px solid ${color.accent};
            outline-offset: -2px;
          }
          ` : ''}
          [data-zone-id="${zone.id}"] [data-widget-content] [data-field] {
            cursor: text;
            transition: outline 0.12s, background 0.12s;
          }
          /* A jump hotspot looks equally live but reads as "opens an editor",
             not "type here" — the text it covers is a rendered LIST. */
          [data-zone-id="${zone.id}"] [data-widget-content] [data-field-jump] {
            cursor: pointer;
            transition: outline 0.12s, background 0.12s;
          }
          ${selected ? `
          [data-zone-id="${zone.id}"] [data-widget-content] [data-field]:not([contenteditable="true"]),
          [data-zone-id="${zone.id}"] [data-widget-content] [data-field-jump] {
            outline: 1px dotted rgba(99, 102, 241, 0.55);
            outline-offset: 2px;
            border-radius: 3px;
          }
          ` : ''}
          [data-zone-id="${zone.id}"] [data-widget-content] [data-field]:not([contenteditable="true"]):hover,
          [data-zone-id="${zone.id}"] [data-widget-content] [data-field-jump]:hover {
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
