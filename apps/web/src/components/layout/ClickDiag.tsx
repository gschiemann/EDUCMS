"use client";

import { useEffect, useState } from 'react';

/**
 * TEMPORARY click diagnostic (2026-06-08).
 *
 * The "every nav link needs two clicks" report only reproduces with a real
 * mouse in a real browser window — no automated/headless tool replicates it,
 * because they keep the window "active." So we instrument the live app and
 * let the operator screenshot the result (same pattern as the player splash
 * diagnostic overlay). NO console needed.
 *
 * Enable: add `?clickdiag=1` to any dashboard URL (persists for the tab via
 * sessionStorage so it survives navigation). Disable: `?clickdiag=0`.
 *
 * On each pointer/click it records, in document CAPTURE phase (before the app
 * sees it): the event type, the target, whether the DOCUMENT had focus, what
 * the active element was, whether default was prevented, and the TOP element
 * actually at the click point (reveals an intercepting overlay). The panel is
 * pointer-events:none so it can never affect the very clicks it measures.
 *
 * Remove this component once the bug is root-caused.
 */
export function ClickDiag() {
  const [enabled, setEnabled] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const v = new URLSearchParams(window.location.search).get('clickdiag');
      if (v === '1') sessionStorage.setItem('clickdiag', '1');
      else if (v === '0') sessionStorage.removeItem('clickdiag');
    } catch { /* ignore */ }

    let on = false;
    try { on = sessionStorage.getItem('clickdiag') === '1'; } catch { /* ignore */ }
    setEnabled(on);
    if (!on) return;

    try {
      const saved = sessionStorage.getItem('clickdiag_trace');
      if (saved) setLines(JSON.parse(saved));
    } catch { /* ignore */ }

    const desc = (el: Element | null): string => {
      if (!el) return 'null';
      const id = (el as HTMLElement).id ? '#' + (el as HTMLElement).id : '';
      const cls = typeof el.className === 'string' && el.className
        ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
        : '';
      return (el.tagName.toLowerCase() + id + cls).slice(0, 46);
    };

    const buf: string[] = [];
    const onEvt = (e: Event) => {
      const me = e as MouseEvent;
      let top: Element | null = null;
      try {
        if (typeof me.clientX === 'number') top = document.elementFromPoint(me.clientX, me.clientY);
      } catch { /* ignore */ }
      buf.push(
        `${e.type.padEnd(11)} winFocus=${document.hasFocus()} ` +
        `active=${desc(document.activeElement)} ` +
        `top=${desc(top)} ` +
        `tgt=${desc(e.target as Element)} prevented=${e.defaultPrevented}`,
      );
      if (e.type === 'click') {
        const out = buf.slice(-12);
        setLines(out);
        try { sessionStorage.setItem('clickdiag_trace', JSON.stringify(out)); } catch { /* ignore */ }
        buf.length = 0;
      }
    };

    const types = ['pointerdown', 'mousedown', 'mouseup', 'click'];
    types.forEach((t) => document.addEventListener(t, onEvt, true));
    return () => types.forEach((t) => document.removeEventListener(t, onEvt, true));
  }, []);

  if (!enabled) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed', left: 8, bottom: 8, zIndex: 2147483647,
        maxWidth: '94vw', background: 'rgba(2,6,23,0.96)', color: '#7CFC00',
        font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
        padding: '10px 12px', borderRadius: 10, border: '1px solid #3b4252',
        pointerEvents: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ color: '#fff', fontWeight: 700, marginBottom: 6 }}>
        CLICK DIAG — screenshot this, then click one nav link
      </div>
      {lines.length
        ? lines.map((l, i) => <div key={i}>{l}</div>)
        : <div style={{ color: '#fbbf24' }}>waiting for a click…</div>}
    </div>
  );
}
