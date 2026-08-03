// Jest stand-in for `next-intl`, which ships ESM-only (see jest.config.js —
// same situation as `lucide-react/dynamic`; transforming the real package
// would slow every suite and still require per-test providers). Resolves
// translations from the real English catalog so suites written against the
// pre-i18n hardcoded copy keep asserting the same visible strings.
import * as React from 'react';
import en from '../src/i18n/messages/en.json';

type Values = Record<string, unknown> | undefined;

function resolve(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      en,
    );
}

function interpolate(msg: string, values?: Values): string {
  // Rich tags render their inner text; ICU-ish {var} placeholders substitute.
  let out = msg.replace(/<(\w+)>([\s\S]*?)<\/\1>/g, '$2');
  if (values) {
    out = out.replace(/\{(\w+)(?:,[^}]*)?\}/g, (m, name) =>
      name in values && typeof values[name] !== 'function'
        ? String(values[name])
        : m,
    );
  }
  return out;
}

export function useTranslations(namespace?: string) {
  const full = (key: string) => (namespace ? `${namespace}.${key}` : key);
  const t = (key: string, values?: Values): string => {
    const raw = resolve(full(key));
    // Missing key → return the key path, same shape next-intl falls back to.
    return typeof raw === 'string' ? interpolate(raw, values) : full(key);
  };
  t.rich = (key: string, values?: Values) => t(key, values);
  t.markup = (key: string, values?: Values) => t(key, values);
  t.raw = (key: string) => {
    const raw = resolve(full(key));
    return raw === undefined ? full(key) : raw;
  };
  t.has = (key: string) => resolve(full(key)) !== undefined;
  return t;
}

export function useLocale() {
  return 'en';
}
export function useMessages() {
  return en as Record<string, unknown>;
}
export function useTimeZone(): string | undefined {
  return undefined;
}
export function useNow() {
  return new Date();
}
export function useFormatter() {
  return {
    dateTime: (d: Date | number, _opts?: unknown) =>
      new Date(d).toLocaleString('en-US'),
    number: (n: number, _opts?: unknown) =>
      new Intl.NumberFormat('en-US').format(n),
    relativeTime: (d: Date | number, _now?: Date | number) =>
      new Date(d).toISOString(),
    list: (items: Iterable<string>, _opts?: unknown) =>
      Array.from(items).join(', '),
  };
}
export function NextIntlClientProvider({
  children,
}: {
  children?: React.ReactNode;
  locale?: string;
  messages?: unknown;
  timeZone?: string;
  onError?: unknown;
  getMessageFallback?: unknown;
}) {
  return <>{children}</>;
}
export type AbstractIntlMessages = Record<string, unknown>;
