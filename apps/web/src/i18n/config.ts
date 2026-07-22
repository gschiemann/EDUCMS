/**
 * App i18n — locale registry + cookie persistence (2026-07-22).
 *
 * ARCHITECTURE (deliberate): locale is resolved CLIENT-SIDE ONLY
 * (I18nProvider reads the cookie after mount). We do NOT read cookies in
 * server components / a next-intl request config on purpose — that would
 * make every route dynamic, killing the static prerender of the marketing
 * site + help center (check-help-prerender.cjs gates on those staying
 * static). The dashboard chrome is client components throughout, so a
 * client provider translates everything that matters, and switching
 * language is an instant in-place re-render — no reload, no URL change,
 * no route restructure.
 *
 * The cookie (not localStorage) is a forward-compat choice: if we ever
 * want SSR-localized marketing pages, the server can read the same cookie.
 */

export const LOCALES = ['en', 'es', 'zh'] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'en';

/** Each language named in ITSELF — the one string we never translate. */
export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: 'English',
  es: 'Español',
  zh: '中文',
};

/** BCP-47 value for <html lang> — zh means Simplified Chinese here. */
export const LOCALE_HTML_LANG: Record<AppLocale, string> = {
  en: 'en',
  es: 'es',
  zh: 'zh-CN',
};

export const LOCALE_COOKIE = 'venueos_locale';

export function isAppLocale(v: string | null | undefined): v is AppLocale {
  return !!v && (LOCALES as readonly string[]).includes(v);
}

export function readLocaleCookie(): AppLocale | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)venueos_locale=([a-zA-Z-]+)/);
  return m && isAppLocale(m[1]) ? m[1] : null;
}

export function writeLocaleCookie(locale: AppLocale): void {
  if (typeof document === 'undefined') return;
  // 1 year, whole app, lax — no sensitive data, just a UI preference.
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}
