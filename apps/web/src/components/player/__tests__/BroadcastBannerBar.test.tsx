/**
 * The broadcast banner bar (2026-11-23): text size and the slower marquee.
 *
 * jsdom has no layout, so the widths the bar measures are stubbed: a scroll
 * clip is 1800 px wide per 1920 px of stage, one copy of the text is
 * `copyShare` of a stage wide (half by default: 960 px on 1920, 1920 px on
 * 3840 - a 4K canvas draws everything twice as wide), and static text "wraps"
 * at the clip width.
 */
import * as React from 'react';
import { render } from '@testing-library/react';
import { bannerFontPx, bannerPxPerSecond } from '@cms/api-types';
import { BroadcastBannerBar } from '../BroadcastBannerBar';

let stage = 1920;
let copyShare = 0.5;
const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.getAttribute('data-banner-text') === 'scroll') return Math.round(stage * (1800 / 1920));
      if (this.parentElement?.hasAttribute('data-banner-track')) return Math.round(stage * copyShare);
      return 0;
    },
  });
  // Static text: ~0.55 em per character, wrapping at the clip width, line-height 1.25.
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.getAttribute('data-banner-text') !== 'static') return 0;
      const px = parseFloat(this.style.fontSize) || 0;
      const clip = stage * (1800 / 1920);
      const lines = Math.max(1, Math.ceil(((this.textContent ?? '').length * px * 0.55) / clip));
      return lines * px * 1.25;
    },
  });
});
afterAll(() => {
  if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
  if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
});

function draw(options: unknown, stageWidth: number, text = 'Early dismissal at 1 pm', share = 0.5) {
  stage = stageWidth;
  copyShare = share;
  const { container } = render(<BroadcastBannerBar severity="INFO" text={text} options={options} stageWidth={stageWidth} />);
  return container;
}
const staticText = (c: HTMLElement) => c.querySelector('[data-banner-text="static"]') as HTMLElement;
const scrollText = (c: HTMLElement) => c.querySelector('[data-banner-text="scroll"]') as HTMLElement;

describe('text size', () => {
  it.each([
    [1920, 'small', 33], [1920, 'medium', 42], [1920, 'large', 58],
    [3840, 'small', 65], [3840, 'medium', 84], [3840, 'large', 115],
  ] as const)('static text on a %d px stage at %s starts at %d px', (w, size, px) => {
    const c = draw({ mode: 'static', size }, w);
    expect(staticText(c).style.fontSize).toBe(`${px}px`);
    expect(staticText(c).getAttribute('data-banner-size')).toBe(size);
  });

  it.each([
    [1920, 'small', 33], [1920, 'medium', 42], [1920, 'large', 58],
    [3840, 'small', 65], [3840, 'medium', 84], [3840, 'large', 115],
  ] as const)('scrolling text on a %d px stage at %s is %d px', (w, size, px) => {
    const c = draw({ mode: 'scroll', speed: 'slow', size }, w);
    expect(scrollText(c).style.fontSize).toBe(`${px}px`);
    expect(scrollText(c).getAttribute('data-banner-size')).toBe(size);
  });

  it('an older message (no size) and an unknown size draw medium, exactly as before', () => {
    expect(staticText(draw({ mode: 'static', speed: 'normal' }, 1920)).style.fontSize).toBe('42px');
    expect(staticText(draw({ mode: 'static', size: 'enormous' }, 1920)).style.fontSize).toBe('42px');
    expect(scrollText(draw({ mode: 'scroll', speed: 'fast' }, 3840)).style.fontSize).toBe('84px');
  });

  it('no options keeps the legacy look (no stage-relative text at all)', () => {
    const c = draw(undefined, 1920);
    expect(c.querySelector('[data-banner-text]')).toBeNull();
    expect(c.querySelector('.text-xl')).toBeTruthy();
  });

  it('large static text still shrinks to fit 2 lines, never below its floor', () => {
    const fits = 'Buses are running fifteen minutes late today because of the weather.'; // ~70 chars
    const long = 'Please remember that the north parking lot is closed for resurfacing until Friday. '.repeat(2); // ~170 chars
    const huge = 'x'.repeat(2000);
    for (const w of [1920, 3840]) {
      const { base, floor } = bannerFontPx('large', w);
      // A short line stays at the full large size.
      expect(parseFloat(staticText(draw({ mode: 'static', size: 'large' }, w, fits)).style.fontSize)).toBe(base);
      // A long one shrinks until it fits 2 lines.
      const el = staticText(draw({ mode: 'static', size: 'large' }, w, long));
      const px = parseFloat(el.style.fontSize);
      expect(px).toBeLessThan(base);
      expect(px).toBeGreaterThanOrEqual(floor);
      expect(el.scrollHeight).toBeLessThanOrEqual(px * 1.25 * 2 + 2);
      // Nothing makes it smaller than the floor.
      expect(parseFloat(staticText(draw({ mode: 'static', size: 'large' }, w, huge)).style.fontSize)).toBe(floor);
    }
  });
});

describe('scroll speed (one stage width every 48 s / 30 s / 20 s)', () => {
  // A copy half a stage wide needs 2 copies to fill the bar: one loop slides
  // both (one stage width), so it takes a whole stage's crossing time.
  it.each([
    [1920, 'slow', 48], [1920, 'normal', 30], [1920, 'fast', 20],
    [3840, 'slow', 48], [3840, 'normal', 30], [3840, 'fast', 20],
  ] as const)('on a %d px stage, %s takes %d s per loop', (w, speed, seconds) => {
    const c = draw({ mode: 'scroll', speed }, w);
    const el = scrollText(c);
    expect(el.getAttribute('data-banner-speed')).toBe(speed);
    expect(el.getAttribute('data-banner-seconds')).toBe(String(seconds));
    const track = el.querySelector('[data-banner-track]') as HTMLElement;
    expect(track.style.animation).toContain(`${seconds}s`);
    expect(track.style.animation).toContain('linear');
  });

  it('the size does not change the speed', () => {
    for (const size of ['small', 'medium', 'large']) {
      expect(scrollText(draw({ mode: 'scroll', speed: 'slow', size }, 1920)).getAttribute('data-banner-seconds')).toBe('48');
    }
  });

  // The 2026-11-23 bug: the loop was timed by ONE copy while the track slid
  // half its copies, so a short message ran 2-3x the chosen speed.
  it.each([
    [0.39, 'a ~25-character message (3 copies fill the bar)'],
    [0.87, 'a ~60-character message (2 copies)'],
    [2.03, 'a ~150-character message (1 copy)'],
  ])('a copy %p of the stage wide - %s - moves at exactly the chosen speed', (share) => {
    for (const w of [1920, 3840]) {
      for (const speed of ['slow', 'normal', 'fast'] as const) {
        const el = scrollText(draw({ mode: 'scroll', speed }, w, 'x', share));
        const track = el.querySelector('[data-banner-track]') as HTMLElement;
        const seconds = Number(el.getAttribute('data-banner-seconds'));
        // The keyframes slide -50% of the track: half its copies.
        const distance = (track.children.length / 2) * Math.round(w * share);
        expect(distance).toBeGreaterThanOrEqual(Math.round(w * (1800 / 1920))); // seamless: a loop covers the bar
        expect(distance / seconds).toBeCloseTo(bannerPxPerSecond(w, speed), 0);
      }
    }
  });

  it('the track is a seamless even number of copies and moves by transform only', () => {
    const c = draw({ mode: 'scroll', speed: 'normal', size: 'large' }, 1920);
    const track = scrollText(c).querySelector('[data-banner-track]') as HTMLElement;
    expect(track.children.length % 2).toBe(0);
    expect(track.children.length).toBeGreaterThanOrEqual(2);
    expect(c.innerHTML).toContain('translate3d(-50%,0,0)');
    expect(c.innerHTML).not.toMatch(/\binset\s*:/);
  });
});
