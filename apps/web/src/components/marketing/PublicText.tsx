'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useLocaleSwitch } from '@/i18n/I18nProvider';

/**
 * Tiny client leaves for the public (marketing / legal / help) pages
 * (2026-10-22). The pages stay SERVER components — their markup costs no
 * JavaScript — and only the words that follow the reader's language go
 * through these. One shared module instead of a client copy of every page:
 * making the footer and the help article client components put their whole
 * markup into several route chunks and broke the bundle budget.
 */
export function PublicT({
  k,
  values,
  valueKeys,
}: {
  k: string;
  values?: Record<string, string>;
  /** Placeholder values that are themselves catalog keys (translated first). */
  valueKeys?: Record<string, string>;
}) {
  const t = useTranslations('publicSite');
  const resolved: Record<string, string> = { ...values };
  for (const [name, key] of Object.entries(valueKeys ?? {})) resolved[name] = t(key);
  return <>{t(k, resolved)}</>;
}

/**
 * Shows the server-rendered variant for the reader's language, English when
 * there is none. The variants are rendered on the server, so they ride the
 * page payload, never a JavaScript chunk.
 */
export function LocaleVariant({ en, es, zh }: { en: ReactNode; es?: ReactNode; zh?: ReactNode }) {
  const { locale } = useLocaleSwitch();
  const pick = locale === 'es' ? es : locale === 'zh' ? zh : undefined;
  return <>{pick ?? en}</>;
}
