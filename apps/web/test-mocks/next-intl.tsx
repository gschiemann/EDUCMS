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

/**
 * ICU `{n, plural, =0 {…} one {…} other {…}}` — English rules, `#` = the number.
 * Added 2026-09-22 so a suite can assert the real English sentence instead of a
 * half-substituted one; a message with no plural is untouched.
 */
function formatPlurals(msg: string, values: Record<string, unknown>): string {
  let out = '';
  let i = 0;
  while (i < msg.length) {
    const m = /\{(\w+),\s*plural,/.exec(msg.slice(i));
    if (!m) { out += msg.slice(i); break; }
    const start = i + m.index;
    out += msg.slice(i, start);
    // Walk to the matching close brace of the whole plural argument.
    let depth = 0;
    let end = start;
    for (; end < msg.length; end++) {
      if (msg[end] === '{') depth++;
      else if (msg[end] === '}') { depth--; if (depth === 0) break; }
    }
    const body = msg.slice(start + m[0].length, end);
    const options: Record<string, string> = {};
    const optRe = /\s*(=\d+|zero|one|two|few|many|other)\s*\{/g;
    let o: RegExpExecArray | null;
    while ((o = optRe.exec(body)) !== null) {
      let d = 1;
      let j = optRe.lastIndex;
      for (; j < body.length && d > 0; j++) {
        if (body[j] === '{') d++;
        else if (body[j] === '}') d--;
      }
      options[o[1]] = body.slice(optRe.lastIndex, j - 1);
      optRe.lastIndex = j;
    }
    const n = Number(values[m[1]]);
    const pick = options[`=${n}`] ?? (n === 1 ? options.one : undefined) ?? options.other ?? '';
    out += pick.replace(/#/g, String(n));
    i = end + 1;
  }
  return out;
}

function interpolate(msg: string, values?: Values): string {
  // Rich tags render their inner text; ICU-ish {var} placeholders substitute.
  let out = msg.replace(/<(\w+)>([\s\S]*?)<\/\1>/g, '$2');
  if (values) {
    out = formatPlurals(out, values);
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
