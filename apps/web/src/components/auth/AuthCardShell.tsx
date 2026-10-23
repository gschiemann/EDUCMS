"use client";

/**
 * The frame the sign-in family's satellite pages share (password reset
 * request + completion, accept-invite) — the same light card, hex mark,
 * back link and language switcher as /login (QA 2026-10-23).
 *
 * Before this the two reset pages were the only sign-in-family surfaces still
 * on the pre-rebrand dark theme with the old monitor icon, and English-only:
 * the page an operator reaches from the reset EMAIL looked like a different
 * product from the sign-in page it sends them back to, and a Spanish- or
 * Chinese-speaking operator who chose their language on /login lost it here.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LanguageSwitcherInline } from '@/components/layout/LanguageMenu';

export function ResetShell({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('passwordReset');
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafbfc] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-7">
          <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden className="mx-auto">
            <polygon points="30,16 23,28.12 9,28.12 2,16 9,3.88 23,3.88" fill="#4f46e5" />
            <polygon points="22,16 19,21.2 13,21.2 10,16 13,10.8 19,10.8" fill="#a5b4fc" />
          </svg>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-600">{subtitle}</p>}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-7">{children}</div>

        <p className="text-center text-xs mt-6">
          <Link className="font-semibold text-indigo-600 hover:text-indigo-700" href="/login">{t('backToSignIn')}</Link>
        </p>
        <LanguageSwitcherInline className="mt-4" />
      </div>
    </div>
  );
}

export const RESET_INPUT_CLS =
  'w-full min-h-[44px] px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 ' +
  'placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

export const RESET_BUTTON_CLS =
  'w-full min-h-[44px] bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold ' +
  'py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors';
