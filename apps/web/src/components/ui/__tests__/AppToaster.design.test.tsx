/**
 * The toast host wears the dashboard's floating-card design (2026-11-14).
 *
 * Owner, 2026-11-14: "Did we remove the ugly alert screens in the bottom right
 * of the dashboard that popped up before? They are like yellow background and
 * don't match any of our design?" They were sonner `toast.warning` cards, and
 * the yellow came from THIS host's `warning` class (amber-50 fill, amber-200
 * border, amber-900 bold text). 61bdbf873 (2026-11-02) removed their only
 * caller — the "may stutter" publish warnings — and left the style behind, so
 * the next `toast.warning` anywhere would have brought the same card back.
 *
 * jsdom has no Tailwind, so this pins the CLASSES and the wiring. The computed
 * paint they produce in a real browser (white background, 12/16px padding, a
 * 24px close button inside the card, 0px² overlap with the bug button where
 * the old stack overlapped it by 36×36) was measured in Chromium on 2026-11-14.
 */
import fs from 'node:fs';
import path from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import {
  AppToaster,
  TOAST_CLASSNAMES,
  TOAST_STACK_BOTTOM_MOBILE_PX,
  TOAST_STACK_BOTTOM_PX,
} from '../AppToaster';

const TINTED_FILL = /(?:^|\s)(?:[a-z0-9-]+:)*bg-(?:amber|yellow|orange|red|rose|emerald|green|sky|blue)-/;

beforeAll(() => {
  // sonner reads matchMedia for its theme; jsdom doesn't implement it.
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

async function raise(kind: 'warning' | 'error' | 'success' | 'info', text: string) {
  act(() => {
    toast[kind](text);
  });
  await screen.findByText(text);
  const li = document.querySelector<HTMLElement>(`[data-sonner-toast][data-type="${kind}"]`);
  expect(li).not.toBeNull();
  return li!;
}

describe('toast design — a white dashboard card, never a tinted (yellow) slab', () => {
  it('every toast type is a white card; the shared class carries no colour', () => {
    for (const key of ['default', 'loading', 'info', 'success', 'error', 'warning'] as const) {
      expect(TOAST_CLASSNAMES[key]).toMatch(/(?:^|\s)bg-white(?:\s|$)/);
      expect(TOAST_CLASSNAMES[key]).not.toMatch(TINTED_FILL);
      expect(TOAST_CLASSNAMES[key]).toMatch(/(?:^|\s)text-slate-800(?:\s|$)/);
    }
    // A colour on the shared class would race the per-type one by CSS source
    // order (how the first cut rendered a white "error" toast).
    expect(TOAST_CLASSNAMES.toast).not.toMatch(/(?:^|\s)(?:bg|text)-[a-z]+-\d/);
  });

  it('a real toast.warning renders a white card with an amber outline and icon — no yellow fill', async () => {
    render(<AppToaster />);
    const li = await raise('warning', '“Lobby reel.mp4” may stutter on “Gym”.');
    expect(li.className).toMatch(/(?:^|\s)bg-white(?:\s|$)/);
    expect(li.className).toMatch(/(?:^|\s)border-amber-200(?:\s|$)/);
    expect(li.className).not.toMatch(TINTED_FILL);
    expect(li.className).not.toMatch(/text-amber-9\d\d/);
    const icon = li.querySelector('[data-icon] svg');
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute('class')).toMatch(/(?:^|\s)text-amber-600(?:\s|$)/);
  });

  it.each([
    ['error', 'border-rose-200', 'text-rose-600'],
    ['success', 'border-emerald-200', 'text-emerald-600'],
    ['info', 'border-sky-200', 'text-sky-600'],
  ] as const)('%s keeps its tone in the outline and the icon, on white', async (kind, outline, iconTone) => {
    render(<AppToaster />);
    const li = await raise(kind, `A ${kind} toast`);
    expect(li.className).toMatch(/(?:^|\s)bg-white(?:\s|$)/);
    expect(li.className.split(/\s+/)).toContain(outline);
    expect(li.className).not.toMatch(TINTED_FILL);
    expect(li.querySelector('[data-icon] svg')!.getAttribute('class')).toMatch(new RegExp(`(?:^|\\s)${iconTone}(?:\\s|$)`));
  });

  it('the close button sits inside the card (top-right), not hanging off a corner', async () => {
    render(<AppToaster />);
    const li = await raise('warning', 'Close me');
    const close = li.querySelector<HTMLElement>('[data-close-button]');
    expect(close).not.toBeNull();
    const cls = close!.className.split(/\s+/);
    // sonner pins it at the top-LEFT and translates it off the corner.
    for (const c of ['left-auto', 'right-2', 'top-2', '[transform:none]']) expect(cls).toContain(c);
    // ...and the card leaves room for it.
    expect(li.className.split(/\s+/)).toContain('pr-10');
  });

  it('the stack starts above the bug-report button that shares the corner', () => {
    // The FAB's own classes are the authority: if it moves or grows, this
    // fails until the toaster follows. Tailwind spacing = 4px per step.
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'bug-reporter', 'BugReporterButton.tsx'), 'utf8');
    const fab = /className="(fixed [^"]*rounded-full[^"]*)"/.exec(src);
    expect(fab).not.toBeNull();
    const tokens = fab![1].split(/\s+/);
    const step = (re: RegExp) => {
      const t = tokens.find((x) => re.test(x));
      expect(t).toBeDefined();
      return Number(re.exec(t!)![1]) * 4;
    };
    const phoneBottom = step(/^bottom-(\d+)$/);
    const desktopBottom = step(/^md:bottom-(\d+)$/);
    const height = step(/^h-(\d+)$/);
    const AIR = 8;
    expect(TOAST_STACK_BOTTOM_PX).toBeGreaterThanOrEqual(desktopBottom + height + AIR);
    expect(TOAST_STACK_BOTTOM_MOBILE_PX).toBeGreaterThanOrEqual(phoneBottom + height + AIR);
  });

  it('wires those offsets into the toaster', async () => {
    render(<AppToaster />);
    act(() => {
      toast('Offsets');
    });
    await screen.findByText('Offsets');
    const list = document.querySelector<HTMLElement>('[data-sonner-toaster]');
    expect(list).not.toBeNull();
    expect(list!.style.getPropertyValue('--offset-bottom')).toBe(`${TOAST_STACK_BOTTOM_PX}px`);
    expect(list!.style.getPropertyValue('--mobile-offset-bottom')).toBe(
      `calc(${TOAST_STACK_BOTTOM_MOBILE_PX}px + env(safe-area-inset-bottom, 0px))`,
    );
    // Only `bottom` is ours; the other sides keep sonner's defaults.
    expect(list!.style.getPropertyValue('--offset-right')).toBe('24px');
    expect(list!.style.getPropertyValue('--mobile-offset-left')).toBe('16px');
  });
});
