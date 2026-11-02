'use client';

/**
 * OverflowMenu — the "⋯" button (pill audit 2026-11-02, rule 5; lifted from
 * the Media Library's selection MoreMenu, PR #237). A panel on the shared
 * `AnchoredMenu`, so it is never clipped by a card and flips above its
 * trigger near the bottom of the screen.
 *
 * Destructive actions do not belong in here: Delete stays a visible button.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AnchoredMenu } from './anchored-menu';
import { useDismiss } from './use-dismiss';

export interface OverflowItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
  hidden?: boolean;
  /** Draw a hairline above this item (a new group). */
  separated?: boolean;
}

export const OVERFLOW_ICON_BUTTON =
  'min-w-11 min-h-11 sm:min-w-9 sm:min-h-9 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const MENU_ITEM =
  'w-full px-3 py-2 min-h-11 sm:min-h-0 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed';

export interface OverflowMenuProps {
  items: OverflowItem[];
  ariaLabel?: string;
  width?: number;
  testId?: string;
  menuTestId?: string;
  buttonClassName?: string;
}

export function OverflowMenu({ items, ariaLabel, width = 220, testId, menuTestId, buttonClassName }: OverflowMenuProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, anchor, close);
  const shown = items.filter((i) => !i.hidden);
  if (shown.length === 0) return null;
  const label = ariaLabel ?? t('ui.moreActions');

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid={testId}
        onClick={() => setOpen((v) => !v)}
        className={buttonClassName ?? OVERFLOW_ICON_BUTTON}
      >
        <MoreHorizontal className="w-4 h-4" aria-hidden />
      </button>
      <AnchoredMenu anchorRef={anchor} open={open} width={width}>
        <div role="menu" aria-label={label} className="py-1" data-testid={menuTestId}>
          {shown.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={`${MENU_ITEM} ${item.separated ? 'border-t border-slate-100' : ''}`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </AnchoredMenu>
    </>
  );
}
