"use client";

/**
 * Client-side i18n provider (see the architecture note in ./config.ts —
 * locale is resolved on the CLIENT so static prerendering stays intact).
 *
 * Hydration safety: SSR/SSG and the first client paint always render the
 * DEFAULT locale (English) — identical markup — then the persisted choice
 * is applied right after mount. Switching loads the catalog on demand
 * (per-locale async chunk; English is inlined as the fallback) and
 * re-renders in place: no reload, no navigation.
 */

import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import en from './messages/en.json';
import {
  type AppLocale,
  DEFAULT_LOCALE,
  LOCALE_HTML_LANG,
  detectDeviceLocale,
  readLocaleCookie,
  writeLocaleCookie,
} from './config';

const CATALOGS: Record<AppLocale, () => Promise<{ default: AbstractIntlMessages }>> = {
  en: () => Promise.resolve({ default: en as AbstractIntlMessages }),
  es: () => import('./messages/es.json') as Promise<{ default: AbstractIntlMessages }>,
  zh: () => import('./messages/zh.json') as Promise<{ default: AbstractIntlMessages }>,
};

const LocaleSwitchContext = createContext<{
  locale: AppLocale;
  setLocale: (l: AppLocale) => void;
}>({ locale: DEFAULT_LOCALE, setLocale: () => {} });

/** Current locale + setter for the language switcher UI. */
export function useLocaleSwitch() {
  return useContext(LocaleSwitchContext);
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(DEFAULT_LOCALE);
  const [messages, setMessages] = useState<AbstractIntlMessages>(en as AbstractIntlMessages);
  // Stable timeZone for SSR/prerender + first client paint (silences
  // next-intl's ENVIRONMENT_FALLBACK build noise); the real browser zone is
  // adopted after mount. We do no date formatting through next-intl yet, so
  // the swap is invisible today — but correct whenever formatting arrives.
  const [timeZone, setTimeZone] = useState('UTC');

  const apply = useCallback(async (l: AppLocale) => {
    const mod = await CATALOGS[l]();
    setMessages(mod.default);
    setLocaleState(l);
    // Keep the document language honest for screen readers + font stacks
    // (globals.css keys CJK font fallbacks off html[lang]).
    document.documentElement.lang = LOCALE_HTML_LANG[l];
  }, []);

  // AFTER mount (never during SSR/first paint — that's what keeps hydration
  // clean against the English static shell): an EXPLICIT saved choice always
  // wins; otherwise auto-pick from the device's preferred languages. The
  // auto-pick deliberately does NOT write the cookie — only an explicit
  // switch persists — so a device-language user keeps getting the best match
  // as we ship more languages, while a chosen language sticks forever.
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const target = readLocaleCookie() ?? detectDeviceLocale();
    if (target !== DEFAULT_LOCALE) void apply(target);
  }, [apply]);

  const setLocale = useCallback(
    (l: AppLocale) => {
      writeLocaleCookie(l);
      void apply(l);
    },
    [apply],
  );

  return (
    <LocaleSwitchContext.Provider value={{ locale, setLocale }}>
      <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
        {children}
      </NextIntlClientProvider>
    </LocaleSwitchContext.Provider>
  );
}
