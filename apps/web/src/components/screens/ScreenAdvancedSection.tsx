'use client';

/**
 * ScreenAdvancedSection — the closed-by-default "Advanced" group at the
 * bottom of the screen Settings tab (2026-11-01). Everything an everyday
 * operator does not need lives behind it: Android settings, network, how
 * sleep works, and diagnostics. Children mount only once it is opened, so a
 * closed section costs no request (the Android-settings read fires on open).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';

export function ScreenAdvancedSection({ children }: { children: React.ReactNode }) {
  const t = useTranslations('screens.settingsTab');
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-slate-100" data-testid="advanced-section">
      <button
        type="button"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-full flex items-center gap-3 px-3.5 py-3 min-h-[52px] text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
      >
        <SlidersHorizontal className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-bold text-slate-700">{t('advanced')}</span>
          <span className="block text-[11px] text-slate-400 mt-0.5">{t('advancedHint')}</span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && <div data-testid="advanced-body">{children}</div>}
    </div>
  );
}
