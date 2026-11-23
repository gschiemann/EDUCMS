/**
 * The browser picks its spell-check dictionary from the document language, so
 * `<html lang>` must follow the operator's UI language (en / es / zh). The
 * root layout renders `lang="en"` (the static shell is English); I18nProvider
 * rewrites it whenever a language is applied — a saved choice on mount, or a
 * switch. This pins that behaviour (2026-11-23, spell check everywhere).
 */
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { I18nProvider, useLocaleSwitch } from '../I18nProvider';

let switchTo: ((l: 'en' | 'es' | 'zh') => void) | null = null;
function Grab() {
  const { setLocale } = useLocaleSwitch();
  useEffect(() => { switchTo = setLocale; }, [setLocale]);
  return null;
}

const realFetch = global.fetch;
beforeEach(() => {
  document.documentElement.lang = 'en';
  document.cookie = 'venueos_locale=; max-age=0; path=/';
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
});
afterEach(() => {
  global.fetch = realFetch;
  switchTo = null;
});

it('sets <html lang> to the language the operator switches to', async () => {
  render(<I18nProvider><Grab /></I18nProvider>);
  await act(async () => { switchTo!('es'); });
  expect(document.documentElement.lang).toBe('es');
  await act(async () => { switchTo!('zh'); });
  expect(document.documentElement.lang).toBe('zh-CN');
  await act(async () => { switchTo!('en'); });
  expect(document.documentElement.lang).toBe('en');
});

it('applies a saved language to <html lang> on mount', async () => {
  document.cookie = 'venueos_locale=es; path=/';
  await act(async () => { render(<I18nProvider><Grab /></I18nProvider>); });
  expect(document.documentElement.lang).toBe('es');
});

it('keeps lang="en" when a catalog cannot load (the page stays in English)', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  render(<I18nProvider><Grab /></I18nProvider>);
  await act(async () => { switchTo!('zh'); });
  expect(document.documentElement.lang).toBe('en');
  warn.mockRestore();
});
