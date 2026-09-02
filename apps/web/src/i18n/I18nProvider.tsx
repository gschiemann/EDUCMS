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

/**
 * Non-default catalogs are FETCHED as static JSON (public/locales/*.json,
 * emitted at build/dev start by scripts/emit-locale-catalogs.cjs), not
 * `import()`-ed. An imported JSON catalog becomes a ~130 KB JavaScript chunk
 * that counts against the ratcheted bundle ceiling and is parsed as JS on
 * every switch; a fetched one is cached by the CDN and costs the JS budget
 * nothing. The build SHA is the cache-buster so a new deploy never serves a
 * stale catalog against a new bundle. English stays inlined: it is the
 * SSR/first-paint fallback and must never wait on the network.
 *
 * A failed fetch keeps the English messages already on screen and logs —
 * the same "fail to the default language" the old dynamic import had.
 */
const CATALOG_VERSION = process.env.NEXT_PUBLIC_BUILD_SHA || 'dev';
async function fetchCatalog(locale: AppLocale): Promise<{ default: AbstractIntlMessages }> {
  const res = await fetch(`/locales/${locale}.json?v=${encodeURIComponent(CATALOG_VERSION)}`, {
    cache: 'force-cache',
  });
  if (!res.ok) throw new Error(`locale catalog ${locale}: HTTP ${res.status}`);
  return { default: (await res.json()) as AbstractIntlMessages };
}
const CATALOGS: Record<AppLocale, () => Promise<{ default: AbstractIntlMessages }>> = {
  en: () => Promise.resolve({ default: en as AbstractIntlMessages }),
  es: () => fetchCatalog('es'),
  zh: () => fetchCatalog('zh'),
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
    let mod: { default: AbstractIntlMessages };
    try {
      mod = await CATALOGS[l]();
    } catch (e) {
      console.warn(`[i18n] could not load the ${l} catalog — staying on English:`, (e as Error)?.message);
      return;
    }
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
