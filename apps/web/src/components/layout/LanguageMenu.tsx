"use client";

import { Check, Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LOCALES, LOCALE_LABELS } from '@/i18n/config';
import { useLocaleSwitch } from '@/i18n/I18nProvider';
import { cn } from '@/lib/utils';

/**
 * Language rows for the avatar dropdown (TopToolbar). One row per locale,
 * check on the active one — switching re-renders the whole chrome in place
 * (no reload). Each language is named in itself so an operator who can't
 * read the CURRENT language can still find their own.
 */
export function LanguageMenuRows({ onPicked }: { onPicked?: () => void }) {
  const { locale, setLocale } = useLocaleSwitch();
  const t = useTranslations('language');
  return (
    <div className="border-t border-slate-100 mt-1 pt-1">
      <p className="px-4 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
        <Globe className="w-3 h-3" aria-hidden /> {t('label')}
      </p>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => {
            setLocale(l);
            onPicked?.();
          }}
          className={cn(
            'w-full text-left px-4 py-2 text-xs flex items-center justify-between gap-2 hover:bg-slate-50',
            l === locale ? 'font-semibold text-indigo-600' : 'font-medium text-slate-700',
          )}
          aria-pressed={l === locale}
        >
          {LOCALE_LABELS[l]}
          {l === locale && <Check className="w-3.5 h-3.5" aria-hidden />}
        </button>
      ))}
    </div>
  );
}

/**
 * Compact inline switcher for public pages (login). A quiet row of the
 * three language names — pre-auth operators need a way in before they can
 * reach the avatar menu.
 */
export function LanguageSwitcherInline({ className }: { className?: string }) {
  const { locale, setLocale } = useLocaleSwitch();
  return (
    // a11y: slate-600, NOT slate-400 — the /login bg (#fafbfc) fails WCAG at
    // slate-400 (~2.5:1); slate-600 is ~7.9:1. Same fix history as the login
    // footer nav (2026-05-26) — axe reds all 9 unauthenticated routes on it.
    <div className={cn('flex items-center justify-center gap-1 text-xs text-slate-600', className)}>
      <Globe className="w-3.5 h-3.5 mr-0.5" aria-hidden />
      {LOCALES.map((l, i) => (
        <span key={l} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden>·</span>}
          <button
            type="button"
            onClick={() => setLocale(l)}
            className={cn(
              'px-1 py-0.5 rounded transition-colors hover:text-slate-800',
              l === locale && 'font-semibold text-slate-800',
            )}
            aria-pressed={l === locale}
          >
            {LOCALE_LABELS[l]}
          </button>
        </span>
      ))}
    </div>
  );
}
