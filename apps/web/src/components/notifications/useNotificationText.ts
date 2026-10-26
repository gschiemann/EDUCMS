"use client";

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useLocaleSwitch } from '@/i18n/I18nProvider';
import { LOCALE_HTML_LANG } from '@/i18n/config';
import { localizeNotification, type LocalizableNotification } from './notificationCopy';
import { humanizeTimestamps, relativeAgeParts } from './notificationInbox';

/**
 * The bell and the inbox read notifications through this, so both say the
 * same thing in the reader's language: the localized title and body
 * (`notificationCopy.ts`), any machine timestamp left in free text made
 * readable, and the row's age ("6m ago" / "hace 6 min" / "6 分钟前").
 */
export function useNotificationText() {
  const tServer = useTranslations('notifications.server');
  const tAge = useTranslations('notifications.age');
  const { locale } = useLocaleSwitch();
  const lang = LOCALE_HTML_LANG[locale] ?? 'en';

  const formatTime = useCallback(
    (ms: number) => {
      try {
        return new Date(ms).toLocaleString(lang, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      } catch {
        return new Date(ms).toISOString();
      }
    },
    [lang],
  );

  const text = useCallback(
    (n: LocalizableNotification) => {
      const out = localizeNotification(n, { t: tServer, formatTime });
      return {
        title: out.title,
        body: out.body ? (out.bodyLocalized ? out.body : humanizeTimestamps(out.body, lang)) : null,
      };
    },
    [tServer, formatTime, lang],
  );

  /** "just now" / "6m ago" … or null for a future or unparseable stamp. */
  const age = useCallback(
    (iso: string, now?: number) => {
      const p = relativeAgeParts(iso, now);
      if (!p) return null;
      return p.unit === 'justNow' ? tAge('justNow') : tAge(p.unit, { count: p.count });
    },
    [tAge],
  );

  return { text, age };
}
