// Client-safe types and static metadata for the help center. Anything that
// reads from the filesystem must live in index.ts (server-only).

export type HelpCategory =
  | 'Getting Started'
  | 'Templates'
  | 'AI Studio'
  | 'Screens'
  | 'Emergency System'
  | 'Sports'
  | 'Integrations'
  | 'SSO'
  | 'Clever'
  | 'Billing'
  | 'IT & Security';

/** Locales an article may carry a translation for (`<slug>.<locale>.md`). */
export type HelpTranslationLocale = 'es' | 'zh';

export interface HelpArticleTranslation {
  title: string;
  excerpt: string;
  body: string;
}

export interface HelpArticle {
  slug: string;
  title: string;
  category: HelpCategory;
  updated: string;
  excerpt: string;
  body: string;
  /**
   * Optional translations (2026-10-22). Present only when `<slug>.es.md` /
   * `<slug>.zh.md` exist next to the English file; the article page and the
   * hub show them when the reader's language matches, English otherwise.
   */
  translations?: Partial<Record<HelpTranslationLocale, HelpArticleTranslation>>;
}

export const HELP_CATEGORIES: {
  name: HelpCategory;
  color: string;
}[] = [
  { name: 'Getting Started', color: 'from-indigo-500 to-violet-500' },
  { name: 'Templates', color: 'from-fuchsia-500 to-pink-500' },
  { name: 'AI Studio', color: 'from-violet-500 to-purple-500' },
  { name: 'Screens', color: 'from-emerald-500 to-teal-500' },
  { name: 'Emergency System', color: 'from-red-500 to-rose-500' },
  { name: 'Sports', color: 'from-green-500 to-emerald-500' },
  { name: 'Integrations', color: 'from-orange-500 to-amber-500' },
  { name: 'SSO', color: 'from-sky-500 to-cyan-500' },
  { name: 'Clever', color: 'from-amber-500 to-orange-500' },
  { name: 'Billing', color: 'from-slate-600 to-slate-800' },
  { name: 'IT & Security', color: 'from-slate-500 to-indigo-600' },
];

/** Catalog key of each category (`publicSite.help.categories.<key>`). */
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
