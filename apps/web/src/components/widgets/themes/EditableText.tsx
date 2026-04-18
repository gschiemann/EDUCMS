"use client";

/**
 * EditableText — a FitText wrapper that turns its content into an
 * inline-editable text node when the builder isn't in preview mode.
 *
 * Usage:
 *   <EditableText configKey="content" max={260} ...> {config.content} </EditableText>
 *
 * The widget component passes through an `onConfigChange` prop (added
 * to every themed widget's signature). When the user double-clicks (or
 * single-clicks if already selected) an EditableText, it becomes
 * `contentEditable`. On blur or Enter it fires
 * `onConfigChange({ [configKey]: newText })`, which BuilderZone forwards
 * into the Zustand store. Escape reverts.
 *
 * When `onConfigChange` is undefined (player view, preview modal,
 * thumbnail), EditableText is 100% equivalent to a plain FitText —
 * zero runtime cost, no editable chrome, no listeners.
 *
 * Why not contentEditable inside FitText directly? FitText's
 * ResizeObserver + polling churns the child layout constantly; mixing
 * caret state with layout-driven re-renders creates a bad typing
 * experience (caret jumps, cursor resets). Instead we render a plain
 * editable <span> while editing and swap back to FitText on blur.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FitText } from './FitText';

interface Props {
  children: React.ReactNode;
  /** The zone's config key to write on commit. If omitted, EditableText is read-only. */
  configKey?: string;
  /** Builder wiring — forwarded from BuilderZone via the widget's config handler. */
  onConfigChange?: (patch: Record<string, any>) => void;
  /** FitText props — passed through. */
  max?: number;
  min?: number;
  style?: React.CSSProperties;
  className?: string;
  center?: boolean;
  lineHeight?: number;
  wrap?: boolean;
  /** If true (default), clicking starts edit. Disable for cases where
   *  click should do something else (e.g. a link widget). */
  clickToEdit?: boolean;
}

export function EditableText({
  children, configKey, onConfigChange,
  max, min, style, className, center, lineHeight, wrap,
  clickToEdit = true,
}: Props) {
  const canEdit = !!configKey && !!onConfigChange && clickToEdit;
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  const initialText = typeof children === 'string' ? children : (Array.isArray(children) ? children.join('') : String(children ?? ''));

  // Focus + select-all when entering edit mode
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      // Place caret at end of content
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [editing]);

  const commit = useCallback(() => {
    if (!ref.current || !onConfigChange || !configKey) { setEditing(false); return; }
    const next = (ref.current.textContent || '').trim();
    setEditing(false);
    if (next !== initialText.trim()) {
      onConfigChange({ [configKey]: next });
    }
  }, [configKey, onConfigChange, initialText]);

  const cancel = useCallback(() => {
    if (ref.current) ref.current.textContent = initialText;
    setEditing(false);
  }, [initialText]);

  if (!editing) {
    return (
      <div
        style={{ width: '100%', height: '100%', position: 'relative' }}
        onDoubleClick={canEdit ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
        title={canEdit ? 'Double-click to edit' : undefined}
      >
        <FitText
          max={max} min={min} style={style} className={className}
          center={center} lineHeight={lineHeight} wrap={wrap}
        >
          {children}
        </FitText>
        {canEdit && (
          // Subtle dashed outline on hover as an affordance. Only
          // renders when the widget is in an editable context.
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: 0,
              pointerEvents: 'none',
              border: '2px dashed transparent',
              borderRadius: 6,
              transition: 'border-color 0.15s',
            }}
            className="edit-hover-outline"
          />
        )}
      </div>
    );
  }

  // Editing mode — render a plain editable span so FitText's RO churn
  // doesn't fight with caret stability. Sized to the wrapper; user can
  // see their typing at a predictable size. We intentionally DON'T
  // auto-fit during typing; re-fit happens on commit.
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: center !== false ? 'center' : 'flex-start',
      justifyContent: center !== false ? 'center' : 'flex-start',
      overflow: 'hidden',
    }}>
      <span
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
        onClick={(e) => e.stopPropagation()}
        style={{
          outline: '2px solid #6366f1',
          outlineOffset: 2,
          borderRadius: 4,
          padding: '2px 6px',
          background: 'rgba(99,102,241,0.08)',
          fontSize: max ? Math.min(max, 120) : 60,
          lineHeight: lineHeight ?? 1.1,
          maxWidth: '100%',
          whiteSpace: wrap === false ? 'nowrap' : 'normal',
          cursor: 'text',
          ...style,
        }}
      >
        {initialText}
      </span>
    </div>
  );
}
