import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WebsitePreviewThumb } from '../WebsitePreviewThumb';
import { websitePreviewUrl } from '@/lib/website-preview';

/**
 * The shared website thumbnail. Every surface that draws a website uses it,
 * so what it promises is pinned once, here: the picture is the screenshot, a
 * screenshot that is still being taken is retried exactly the way every inline
 * copy always retried it, and a URL that must not be sent is never requested.
 */

describe('a public website', () => {
  it('shows the screenshot, named for the website', () => {
    render(<WebsitePreviewThumb url="https://example.test/homes" name="Homes" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', websitePreviewUrl('https://example.test/homes'));
    expect(img).toHaveAccessibleName('Website preview of Homes');
    // The whole page, never a crop of it.
    expect(img.className).toContain('object-contain');
    expect(img.className).not.toContain('object-cover');
  });

  it('is still named when it has no name', () => {
    render(<WebsitePreviewThumb url="https://example.test" />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Website preview');
  });

  it('is invisible until the picture has loaded, so a half-decoded frame never flashes', () => {
    render(<WebsitePreviewThumb url="https://example.test" />);
    const img = screen.getByRole('img');
    expect(img.className).toContain('opacity-0');
    fireEvent.load(img);
    expect(img.className).toContain('opacity-100');
  });
});

describe('the screenshot service is still taking the picture ("warming")', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const src = () => screen.getByRole('img').getAttribute('src') ?? '';

  it('retries 3 times, 1.5 s / 3 s / 4.5 s apart — the cadence every inline copy used — then settles on a labelled globe', () => {
    render(<WebsitePreviewThumb url="https://example.test" name="Homes" />);
    const first = src();
    expect(first).not.toContain('retry=');

    for (const [attempt, delay] of [[1, 1500], [2, 3000], [3, 4500]] as const) {
      fireEvent.error(screen.getByRole('img'));
      // Not a moment early…
      act(() => { jest.advanceTimersByTime(delay - 1); });
      expect(src()).not.toContain(`retry=${attempt}`);
      // …and exactly on time.
      act(() => { jest.advanceTimersByTime(1); });
      expect(src()).toContain(`&retry=${attempt}`);
    }

    // The fourth failure is final: no more timers, no broken image, a named globe.
    fireEvent.error(screen.getByRole('img'));
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName('Website preview of Homes unavailable');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a retry that succeeds keeps the screenshot', () => {
    render(<WebsitePreviewThumb url="https://example.test" />);
    fireEvent.error(screen.getByRole('img'));
    act(() => { jest.advanceTimersByTime(1500); });
    fireEvent.load(screen.getByRole('img'));
    expect(src()).toContain('&retry=1');
    expect(screen.getByRole('img').className).toContain('opacity-100');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a pending retry is cancelled when the website changes, and the new one starts clean', () => {
    const { rerender, unmount } = render(<WebsitePreviewThumb url="https://one.test" />);
    fireEvent.error(screen.getByRole('img'));
    rerender(<WebsitePreviewThumb url="https://two.test" />);
    act(() => { jest.advanceTimersByTime(10_000); });
    expect(src()).toBe(websitePreviewUrl('https://two.test'));
    expect(src()).not.toContain('retry=');
    fireEvent.error(screen.getByRole('img'));
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('a URL that must not be sent to a third party', () => {
  it.each([
    ['credentials', 'https://user:secret@example.test/'],
    ['localhost', 'http://localhost:3000/'],
    ['a private address', 'http://192.168.1.20/signage'],
    ['an internal name', 'https://wiki.internal/'],
    ['a non-web scheme', 'javascript:alert(1)'],
  ])('%s: no image is ever requested — the labelled globe from the first paint', (_label, url) => {
    const { container } = render(<WebsitePreviewThumb url={url} name="Intranet" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName('Website preview of Intranet unavailable');
  });

  it('never writes the URL (or a password in it) into the page', () => {
    const { container } = render(<WebsitePreviewThumb url="https://user:secret@example.test/" />);
    expect(container.innerHTML).not.toContain('secret');
    expect(container.querySelector('[title]')).toBeNull();
  });
});
