"use client";

/**
 * Templates Gallery — Calm v1 · the card's three-dot menu (§4.2, §6.5).
 *
 * Calm v1's central move is progressive disclosure: a card shows ONE
 * primary action, and every secondary management action lives here. That
 * only works if the menu itself is trustworthy, so §6.5 is binding:
 *
 *   - opens by click AND keyboard,
 *   - RETURNS FOCUS to the trigger when it closes (otherwise a keyboard
 *     operator who presses Escape is dumped at document.body and has to
 *     Tab back through the whole gallery),
 *   - stays within the viewport (flips to open upward near the bottom),
 *   - Arrow keys / Home / End move between items, Escape closes,
 *   - destructive actions carry a TEXT LABEL — never a bare trash icon.
 *
 * Items are supplied by the caller so an irrelevant action is never shown
 * (§6.5 "Do not show irrelevant actions"): a preset has no Delete, a
 * restricted viewer has no mutations, a non-sports board has no game lane.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface OverflowItem {
  key: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  /** Renders below a divider, in the destructive tone, with its text label. */
  destructive?: boolean;
  disabled?: boolean;
}

export function TemplateOverflowMenu({
  items,
  label,
  buttonClassName,
}: {
  items: OverflowItem[];
  /** Accessible name, e.g. `More actions for Club Welcome`. */
  label: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  /** true → render above the trigger (not enough room below). */
  const [dropUp, setDropUp] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  const enabled = items.filter((i) => !i.disabled);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    // §6.5 — focus goes back to the trigger, always. `restoreFocus=false`
    // only for an outside CLICK, where the operator's own pointer already
    // decided where attention goes.
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Outside click / scroll / resize closes. Bound only while open so an
  // unopened card costs nothing (dozens of these mount per gallery).
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    const onScrollOrResize = () => close(false);
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('touchstart', onDocPointer);
    window.addEventListener('resize', onScrollOrResize);
    // capture:true so a scroll inside any ancestor also dismisses.
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('touchstart', onDocPointer);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, close]);

  /**
   * Viewport containment (§6.5). Measured in the OPEN handler rather than
   * an effect: the decision depends only on where the trigger was when the
   * operator clicked it, so an effect would just be a second render for a
   * value we already had — and the last row of a long gallery is exactly
   * where a menu that always drops down runs off the bottom of the page.
   * jsdom reports zeroes; the `|| 0` fallback keeps it dropping down,
   * which is the normal case.
   */
  const openMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
    const estimated = Math.min(items.length, 8) * 36 + 16;
    setDropUp(!!rect && !!vh && rect.bottom + estimated > vh && rect.top > estimated);
    setOpen(true);
  }, [items.length]);

  // Focus the first item once open — the whole point of a keyboard-openable
  // menu is landing ON something (the player's "focus must be PARKED on a
  // real control" lesson applies to the dashboard too).
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => itemRefs.current.find(Boolean)?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const moveFocus = (delta: number | 'first' | 'last') => {
    const nodes = itemRefs.current.filter((n): n is HTMLButtonElement => !!n && !n.disabled);
    if (nodes.length === 0) return;
    if (delta === 'first') { nodes[0].focus(); return; }
    if (delta === 'last') { nodes[nodes.length - 1].focus(); return; }
    const idx = nodes.indexOf(document.activeElement as HTMLButtonElement);
    const next = idx < 0 ? 0 : (idx + delta + nodes.length) % nodes.length;
    nodes[next].focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case 'ArrowDown': e.preventDefault(); moveFocus(1); break;
      case 'ArrowUp': e.preventDefault(); moveFocus(-1); break;
      case 'Home': e.preventDefault(); moveFocus('first'); break;
      case 'End': e.preventDefault(); moveFocus('last'); break;
      case 'Tab':
        // Tabbing out of a menu closes it rather than leaving a stray
        // popover behind the operator.
        close(false);
        break;
      default:
        break;
    }
  };

  if (enabled.length === 0) return null;

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={(e) => { e.stopPropagation(); if (open) close(); else openMenu(); }}
        onKeyDown={(e) => {
          // Open with ArrowDown/ArrowUp too — the standard menu-button
          // keyboard contract. Enter/Space are the button default.
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMenu(); }
        }}
        className={
          buttonClassName ??
          'inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500 motion-reduce:transition-none'
        }
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          // The menu container owns the arrow-key handling, so it must be
          // able to receive the keydown even in the instant before focus
          // has landed on the first item. -1 keeps it out of the Tab order.
          tabIndex={-1}
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          onClick={(e) => e.stopPropagation()}
          className={`absolute right-0 z-40 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg ${
            dropUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          {items.map((item, i) => {
            const Icon = item.icon;
            const prev = items[i - 1];
            const needsDivider = !!item.destructive && !prev?.destructive && i > 0;
            return (
              <React.Fragment key={item.key}>
                {needsDivider && <div className="my-1 h-px bg-slate-100" role="separator" />}
                <button
                  ref={(n) => { itemRefs.current[i] = n; }}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    // Close BEFORE the action: several of these navigate or
                    // open a dialog, and a menu left mounted over a route
                    // change is how popovers get orphaned.
                    close(false);
                    item.onSelect();
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${
                    item.destructive
                      ? 'text-rose-600 hover:bg-rose-50 focus-visible:bg-rose-50'
                      : 'text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50'
                  }`}
                >
                  {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate">{item.label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
