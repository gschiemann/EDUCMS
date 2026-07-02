"use client";

import { useEffect, useRef, useState } from 'react';
import { Copy, ClipboardPaste, Trash2, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Lock, Unlock, Paintbrush, CopyPlus, Brush } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import type { Zone } from './types';

/**
 * A6 (Wave A — "Crush Canva", 2026-07-02) — right-click context menu on
 * zones + canvas. Pure re-exposure of already-shipped store actions
 * (duplicateZone / removeSelected / moveLayer / toggleLock / updateZones)
 * plus the shell's existing copy/paste clipboard, which arrives via
 * props so ⌘C/⌘V and the menu share ONE clipboard.
 *
 * Zero changes inside BuilderCanvas: a delegated window `contextmenu`
 * listener keys off the canvas's existing `data-template-canvas` root
 * attribute and the zones' `data-zone-id` attributes. Right-click
 * outside the canvas (panels, inputs) keeps the native browser menu.
 *
 * Chromium-83/`inset` rule: menu positioning uses explicit left/top —
 * no `inset` shorthand, no Tailwind `inset-*` classes.
 */

/** Style-ish defaultConfig keys "Copy style" carries between zones. */
const STYLE_KEYS = [
  'fontFamily', 'fontSize', 'color', 'bgColor', 'accentColor',
  'headerBg', 'headerColor', 'bold', 'italic', 'underline',
  'strikethrough', 'textAlign', 'lineHeight', '_styles', '_zoneOpacity',
] as const;

interface Props {
  clipboard: Zone[] | null;
  onCopy: (zones: Zone[]) => void;
  onPaste: () => void;
}

const MENU_WIDTH = 208;

export function CanvasContextMenu({ clipboard, onCopy, onPaste }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; zoneId: string | null } | null>(null);
  // "Copy style" clipboard — local to the menu (Canva scope: style
  // travels within the editing session).
  const styleClipboardRef = useRef<Record<string, unknown> | null>(null);
  // Re-render hook so "Paste style" enables the moment a style is copied.
  const [hasStyle, setHasStyle] = useState(false);

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const st = useBuilderStore.getState();
      if (st.previewMode) return;
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.('[data-template-canvas="true"]')) return;
      e.preventDefault();
      const zoneEl = t.closest('[data-zone-id]') as HTMLElement | null;
      const zoneId = zoneEl?.getAttribute('data-zone-id') ?? null;
      if (zoneId && !st.selectedIds.includes(zoneId)) {
        st.select([zoneId]);
      }
      // Clamp so the menu never renders off-viewport.
      const x = Math.min(e.clientX, Math.max(0, window.innerWidth - MENU_WIDTH - 8));
      const y = Math.min(e.clientY, Math.max(0, window.innerHeight - 360));
      setMenu({ x, y, zoneId });
    };
    window.addEventListener('contextmenu', onCtx);
    return () => window.removeEventListener('contextmenu', onCtx);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-canvas-context-menu]')) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenu(null);
      }
    };
    // Capture phase so the menu closes even when a downstream handler
    // stops propagation (EditableText and friends do).
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  if (!menu) return null;

  const st = useBuilderStore.getState();
  const selected = st.zones.filter((z) => st.selectedIds.includes(z.id));
  const clicked = menu.zoneId ? st.zones.find((z) => z.id === menu.zoneId) ?? null : null;
  const styleSource = clicked ?? selected[0] ?? null;
  const anyLocked = selected.some((z) => z.locked);
  const canPaste = !!clipboard && clipboard.length > 0;

  const close = () => setMenu(null);
  const run = (fn: () => void) => () => { fn(); close(); };

  const copySelection = () => {
    if (selected.length > 0) onCopy(selected.map((z) => ({ ...z })));
  };

  const copyStyle = () => {
    if (!styleSource) return;
    const cfg = (styleSource.defaultConfig || {}) as Record<string, unknown>;
    const picked: Record<string, unknown> = {};
    for (const k of STYLE_KEYS) {
      if (cfg[k] !== undefined) picked[k] = cfg[k];
    }
    styleClipboardRef.current = Object.keys(picked).length > 0 ? picked : null;
    setHasStyle(!!styleClipboardRef.current);
  };

  const pasteStyle = () => {
    const style = styleClipboardRef.current;
    if (!style) return;
    const state = useBuilderStore.getState();
    const ids = state.selectedIds;
    if (ids.length === 0) return;
    state.updateZones(ids, (z) => ({
      defaultConfig: { ...(z.defaultConfig || {}), ...style },
    }), true);
  };

  const itemCls = 'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-40 disabled:pointer-events-none transition-colors';
  const Divider = () => <div className="h-px bg-slate-100 my-1" aria-hidden />;
  const Kbd = ({ k }: { k: string }) => (
    <span className="ml-auto text-[10px] text-slate-400 font-mono">{k}</span>
  );

  return (
    <div
      data-canvas-context-menu="true"
      role="menu"
      aria-label={clicked ? 'Zone actions' : 'Canvas actions'}
      className="py-1.5 rounded-xl bg-white border border-slate-200 shadow-xl"
      style={{ position: 'fixed', left: menu.x, top: menu.y, width: MENU_WIDTH, zIndex: 10001 }}
      // A right-click ON the menu itself shouldn't re-open a native menu
      // or re-trigger the delegated opener.
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {clicked && (
        <>
          <button type="button" role="menuitem" className={itemCls} onClick={run(() => {
            const state = useBuilderStore.getState();
            state.selectedIds.forEach((id) => state.duplicateZone(id));
          })}>
            <CopyPlus className="w-3.5 h-3.5" aria-hidden /> Duplicate <Kbd k="⌘D" />
          </button>
          <button type="button" role="menuitem" className={itemCls} onClick={run(copySelection)}>
            <Copy className="w-3.5 h-3.5" aria-hidden /> Copy <Kbd k="⌘C" />
          </button>
        </>
      )}
      <button type="button" role="menuitem" className={itemCls} disabled={!canPaste} onClick={run(onPaste)}>
        <ClipboardPaste className="w-3.5 h-3.5" aria-hidden /> Paste <Kbd k="⌘V" />
      </button>
      {clicked && (
        <>
          <Divider />
          <button type="button" role="menuitem" className={itemCls} onClick={run(copyStyle)}>
            <Brush className="w-3.5 h-3.5" aria-hidden /> Copy style
          </button>
          <button type="button" role="menuitem" className={itemCls} disabled={!hasStyle} onClick={run(pasteStyle)}>
            <Paintbrush className="w-3.5 h-3.5" aria-hidden /> Paste style
          </button>
          <Divider />
          <button type="button" role="menuitem" className={itemCls} onClick={run(() => {
            const state = useBuilderStore.getState();
            state.selectedIds.forEach((id) => state.moveLayer(id, 'up'));
          })}>
            <ChevronUp className="w-3.5 h-3.5" aria-hidden /> Bring forward
          </button>
          <button type="button" role="menuitem" className={itemCls} onClick={run(() => {
            const state = useBuilderStore.getState();
            state.selectedIds.forEach((id) => state.moveLayer(id, 'down'));
          })}>
            <ChevronDown className="w-3.5 h-3.5" aria-hidden /> Send back
          </button>
          <button type="button" role="menuitem" className={itemCls} onClick={run(() => {
            const state = useBuilderStore.getState();
            state.selectedIds.forEach((id) => state.moveLayer(id, 'top'));
          })}>
            <ChevronsUp className="w-3.5 h-3.5" aria-hidden /> Bring to front
          </button>
          <button type="button" role="menuitem" className={itemCls} onClick={run(() => {
            const state = useBuilderStore.getState();
            state.selectedIds.forEach((id) => state.moveLayer(id, 'bottom'));
          })}>
            <ChevronsDown className="w-3.5 h-3.5" aria-hidden /> Send to back
          </button>
          <Divider />
          <button type="button" role="menuitem" className={itemCls} onClick={run(() => {
            const state = useBuilderStore.getState();
            state.selectedIds.forEach((id) => state.toggleLock(id));
          })}>
            {anyLocked
              ? <><Unlock className="w-3.5 h-3.5" aria-hidden /> Unlock</>
              : <><Lock className="w-3.5 h-3.5" aria-hidden /> Lock</>}
          </button>
          <Divider />
          <button
            type="button"
            role="menuitem"
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
            onClick={run(() => useBuilderStore.getState().removeSelected())}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden /> Delete <Kbd k="Del" />
          </button>
        </>
      )}
    </div>
  );
}
