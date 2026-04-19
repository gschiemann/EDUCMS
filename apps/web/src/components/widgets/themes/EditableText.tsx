"use client";

/**
 * EditableText — a FitText that becomes inline-editable on click when
 * the builder gives it an `onConfigChange` prop.
 *
 * UX goal: match the leading design tools (Figma, Canva, Framer):
 *   1. Hover → a subtle pencil chip appears in the corner.
 *   2. Single click → edit mode opens AT THE SAME FONT SIZE as display
 *      (no size jump — that was the prior bug).
 *   3. Caret is visible (native `<textarea>` cursor + selection).
 *   4. Enter commits. Shift+Enter adds a newline. Esc reverts. Blur
 *      commits.
 *
 * Implementation:
 *   - Display mode renders `<FitText>` as before, with an invisible
 *     click layer above it.
 *   - When the user clicks, we measure the fontSize that FitText
 *     actually picked for the current container (via the rendered
 *     inner span's computed style) and use THAT exact size for the
 *     textarea.
 *   - The textarea is absolutely-positioned over the FitText slot
 *     with the same padding/alignment so the swap is visually
 *     seamless.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FitText } from './FitText';

interface Props {
  children: React.ReactNode;
  /** The zone's config key to write on commit. If omitted, read-only. */
  configKey?: string;
  onConfigChange?: (patch: Record<string, any>) => void;
  max?: number;
  min?: number;
  style?: React.CSSProperties;
  className?: string;
  center?: boolean;
  lineHeight?: number;
  wrap?: boolean;
  /** Whether clicking enters edit mode. Default true. */
  clickToEdit?: boolean;
}

function asString(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(asString).join('');
  return String(children ?? '');
}

export function EditableText({
  children, configKey, onConfigChange,
  max, min, style, className, center = true, lineHeight = 1.1, wrap = true,
  clickToEdit = true,
}: Props) {
  const canEdit = !!configKey && !!onConfigChange && clickToEdit;
  const [editing, setEditing] = useState(false);
  const [editSize, setEditSize] = useState<number>(32);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const initialText = asString(children);

  const enterEdit = useCallback(() => {
    // Read the font-size that FitText picked for the current layout.
    // `<FitText>` renders an inline-block <span> inside its wrapper;
    // the computed font-size on that span IS the fitted size. Copy it
    // onto the textarea so edit-mode visually matches display-mode.
    const host = hostRef.current;
    if (host) {
      const span = host.querySelector('span');
      if (span) {
        const cs = window.getComputedStyle(span);
        const px = parseFloat(cs.fontSize);
        if (Number.isFinite(px) && px > 0) setEditSize(px);
      }
    }
    setEditing(true);
  }, []);

  // Focus + select-all when entering edit
  useLayoutEffect(() => {
    if (editing && taRef.current) {
      const ta = taRef.current;
      ta.focus();
      // Select all text so user can just type to replace
      ta.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    if (!taRef.current || !onConfigChange || !configKey) { setEditing(false); return; }
    const next = taRef.current.value;
    setEditing(false);
    if (next.trim() !== initialText.trim()) {
      onConfigChange({ [configKey]: next });
    }
  }, [configKey, onConfigChange, initialText]);

  const cancel = useCallback(() => { setEditing(false); }, []);

  // Display mode
  if (!editing) {
    return (
      <div
        ref={hostRef}
        style={{ width: '100%', height: '100%', position: 'relative', cursor: canEdit ? 'text' : 'default' }}
        onPointerUp={canEdit ? (e) => { e.stopPropagation(); enterEdit(); } : undefined}
        onClick={canEdit ? (e) => e.stopPropagation() : undefined}
        title={canEdit ? 'Click to edit' : undefined}
      >
        <FitText
          max={max} min={min} style={style} className={className}
          center={center} lineHeight={lineHeight} wrap={wrap}
        >
          {children}
        </FitText>
        {canEdit && (
          // Pencil chip — appears on hover only. Non-interactive so
          // clicks always fall through to enterEdit.
          <div
            aria-hidden
            className="edu-edit-chip"
            style={{
              position: 'absolute',
              top: 4, right: 4,
              width: 20, height: 20,
              borderRadius: 4,
              background: 'rgba(99,102,241,0.92)',
              color: '#fff',
              fontSize: 12,
              lineHeight: '20px',
              textAlign: 'center',
              pointerEvents: 'none',
              opacity: 0,
              transition: 'opacity 0.12s',
              boxShadow: '0 2px 6px rgba(99,102,241,0.4)',
            }}
          >
            ✏
          </div>
        )}
        {canEdit && (
          // Show the chip on host hover. Scoped so it doesn't leak
          // and doesn't require a global stylesheet.
          <style>{`
            div:hover > .edu-edit-chip { opacity: 1; }
          `}</style>
        )}
      </div>
    );
  }

  // Edit mode — textarea matches FitText's computed font-size exactly
  // so there's no visual jump. Native textarea cursor is visible; user
  // sees where they're typing.
  return (
    <div
      style={{
        width: '100%', height: '100%',
        display: 'flex',
        alignItems: center ? 'center' : 'flex-start',
        justifyContent: center ? 'center' : 'flex-start',
        position: 'relative',
        overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <textarea
        ref={taRef}
        defaultValue={initialText}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          e.stopPropagation();
        }}
        spellCheck={false}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          background: 'rgba(99,102,241,0.06)',
          outline: '2px solid #6366f1',
          outlineOffset: '-2px',
          border: 'none',
          resize: 'none',
          padding: '4px 8px',
          textAlign: center ? 'center' : 'left',
          // The crucial line — match the FitText-picked size so edit
          // mode looks identical to display.
          fontSize: editSize,
          lineHeight,
          fontFamily: (style && (style as any).fontFamily) || 'inherit',
          fontWeight: (style && (style as any).fontWeight) || 'inherit',
          color: (style && (style as any).color) || 'inherit',
          letterSpacing: (style && (style as any).letterSpacing) || 'normal',
          whiteSpace: wrap ? 'normal' : 'nowrap',
          overflow: 'hidden',
          caretColor: '#6366f1',
          cursor: 'text',
        }}
      />
    </div>
  );
}
