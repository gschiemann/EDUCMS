'use client';

import { useLocaleSwitch } from '@/i18n/I18nProvider';
import type { HelpArticle, HelpCategory, HelpTranslationLocale } from '@/content/help/types';

/**
 * Help-center localization (2026-10-22). Category labels come from the
 * `publicSite.help.categories.*` catalog keys; an article shows its
 * `<slug>.<locale>.md` translation when one exists and English otherwise.
 * Locale is resolved on the client (see `i18n/config.ts`), so SSR renders
 * English and the reader's language applies right after mount.
 */
export const HELP_CATEGORY_KEY: Record<HelpCategory, string> = {
  'Getting Started': 'gettingStarted',
  Templates: 'templates',
  'AI Studio': 'aiStudio',
  Screens: 'screens',
  'Emergency System': 'emergency',
  Sports: 'sports',
  Integrations: 'integrations',
  SSO: 'sso',
  Clever: 'clever',
  Billing: 'billing',
  'IT & Security': 'itSecurity',
};

export interface LocalizedArticleText {
  title: string;
  excerpt: string;
  body: string;
}

export function localizeArticle(article: HelpArticle, locale: string): LocalizedArticleText {
  const tr = locale === 'en' ? undefined : article.translations?.[locale as HelpTranslationLocale];
  return tr ?? { title: article.title, excerpt: article.excerpt, body: article.body };
}

/** The current dashboard / site language. */
export function useHelpLocale(): string {
  return useLocaleSwitch().locale;
}
