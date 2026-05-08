"use client";

/**
 * useTextStyleOverrides — apply per-text-element style overrides
 * (font size + color + weight) to any DOM element rendered inside an
 * HS widget's stage that carries a `data-field` attribute.
 *
 * The CSS classes baked into each HS widget remain the source of truth
 * for the default look. Overrides are applied imperatively as inline
 * styles AFTER React commits, so they win on specificity (inline >
 * class) but only on the elements the operator has actually customised.
 * If the operator clears an override, the inline style is removed and
 * the class default takes over again.
 *
 * Why imperative DOM walk and not a giant prop-drilling exercise on
 * every widget? Each HS widget has 30-80 text fields and lives at the
 * bottom of a deep render. Threading per-field styles through every
 * span/div would require ~60 prop edits per widget × 16 widgets and
 * would couple the render tree to the override schema.
 *
 * The MutationObserver covers two real cases:
 *   1. Conditional rendering inside the widget that swaps text nodes
 *      based on live data (e.g. weather refresh) — the new node still
 *      needs the operator's override.
 *   2. The transform:scale font-load reflow path inside HsStage where
 *      the inner stage measurements settle on a second animation frame.
 *
 * Usage:
 *   const stageRef = useRef<HTMLDivElement | null>(null);
 *   useTextStyleOverrides(stageRef, c.__styles);
 *   return <HsStage stageRef={stageRef}>...</HsStage>;
 */

import { useEffect, type RefObject } from 'react';

export type TextStyleOverride = {
  /** Font size in CSS pixels. Applied as inline `style.fontSize`. */
  fontSize?: number;
  /** CSS color string (e.g. `#ff0000`, `rgb(0,0,0)`). */
  color?: string;
  /** Numeric font-weight (100..900). 700+ renders as Bold. */
  fontWeight?: number;
  /** Italic toggle. */
  fontStyle?: 'italic' | 'normal';
  /** Underline / strikethrough — joined with space when both set. */
  textDecoration?: 'underline' | 'line-through' | 'underline line-through' | 'none';
  /** CSS font-family stack (matches Google Fonts picker output). */
  fontFamily?: string;
  /** Line-height multiplier (1.0..2.5). */
  lineHeight?: number;
  /** Highlighter — background color on the text run. */
  backgroundColor?: string;
};

export type TextStyleMap = Record<string, TextStyleOverride>;

const STYLE_KEYS = [
  'fontSize',
  'color',
  'fontWeight',
  'fontStyle',
  'textDecoration',
  'fontFamily',
  'lineHeight',
  'backgroundColor',
] as const;

/** Apply / clear overrides on every `[data-field]` element under `root`. */
function applyStyles(root: HTMLElement, styles: TextStyleMap | undefined) {
  const nodes = root.querySelectorAll<HTMLElement>('[data-field]');
  nodes.forEach((el) => {
    const field = el.dataset.field;
    if (!field) return;
    const override = styles?.[field];
    // fontSize ─ inline px when set, blank to fall back to CSS class.
    if (override?.fontSize != null && Number.isFinite(override.fontSize)) {
      el.style.fontSize = `${override.fontSize}px`;
    } else if (el.style.fontSize) {
      el.style.fontSize = '';
    }
    // color ─ hex / rgb when set, blank to fall back.
    if (override?.color) {
      el.style.color = override.color;
    } else if (el.style.color) {
      el.style.color = '';
    }
    // fontWeight ─ 100..900 when set, blank to fall back.
    if (override?.fontWeight != null && Number.isFinite(override.fontWeight)) {
      el.style.fontWeight = String(override.fontWeight);
    } else if (el.style.fontWeight) {
      el.style.fontWeight = '';
    }
    // fontStyle ─ italic / normal.
    if (override?.fontStyle) {
      el.style.fontStyle = override.fontStyle;
    } else if (el.style.fontStyle) {
      el.style.fontStyle = '';
    }
    // textDecoration ─ underline / line-through.
    if (override?.textDecoration) {
      el.style.textDecoration = override.textDecoration;
    } else if (el.style.textDecoration) {
      el.style.textDecoration = '';
    }
    // fontFamily ─ inline stack.
    if (override?.fontFamily) {
      el.style.fontFamily = override.fontFamily;
    } else if (el.style.fontFamily) {
      el.style.fontFamily = '';
    }
    // lineHeight ─ unitless multiplier.
    if (override?.lineHeight != null && Number.isFinite(override.lineHeight)) {
      el.style.lineHeight = String(override.lineHeight);
    } else if (el.style.lineHeight) {
      el.style.lineHeight = '';
    }
    // backgroundColor ─ highlighter.
    if (override?.backgroundColor) {
      el.style.backgroundColor = override.backgroundColor;
    } else if (el.style.backgroundColor) {
      el.style.backgroundColor = '';
    }
  });
}

export function useTextStyleOverrides(
  rootRef: RefObject<HTMLElement | null>,
  styles: TextStyleMap | undefined,
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Initial pass.
    applyStyles(root, styles);
    // Re-apply whenever the widget mounts new `[data-field]` nodes
    // (live-data refreshes, conditional rows, etc.). We only re-walk on
    // mutations that COULD affect data-field elements.
    const observer = new MutationObserver(() => applyStyles(root, styles));
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-field'],
    });
    return () => observer.disconnect();
    // styles is referenced by closure so we re-bind on identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styles, rootRef]);
}

/** Convenience guard: are any keys present on the given override? */
export function hasAnyOverride(o: TextStyleOverride | undefined): boolean {
  if (!o) return false;
  return STYLE_KEYS.some((k) => o[k] != null && o[k] !== '');
}
