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
/** The overlay's height cap on the bar (its padding box, px); null = not capped / not measured. */
let barCap: number | null = null;
const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
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
  // The bar: content-sized up to the cap, as in the browser (jsdom applies no
  // Tailwind padding, so its whole client height is the text's room).
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      const text = Array.from(this.children).find((c) => c.getAttribute('data-banner-text') === 'static') as HTMLElement | undefined;
      if (!text || barCap === null) return 0;
      return Math.min(barCap, text.scrollHeight);
    },
  });
});
afterEach(() => { barCap = null; });
afterAll(() => {
  if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
  if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
  if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
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

describe('static text is never clipped by the overlay cap (2026-11-23 review)', () => {
  // The overlay caps the bar at 40% of the canvas; a 1080 canvas gives 432 px.
  const cap = (h: number) => Math.round(h * 0.4) - 4; // less the 4 px bottom border
  const message = (n: number) => 'Please remember that the north parking lot is closed for resurfacing until Friday. '.repeat(30).slice(0, n);

  it('Large, too long for the cap at its own floor, keeps shrinking until it fits', () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [3840, 2160]] as const) {
      barCap = cap(h);
      const large = bannerFontPx('large', w);
      const small = bannerFontPx('small', w);
      const el = staticText(draw({ mode: 'static', size: 'large' }, w, message(2000)));
      const px = parseFloat(el.style.fontSize);
      expect(px).toBeLessThan(large.floor); // past its own floor
      expect(px).toBeGreaterThanOrEqual(small.floor); // never below the smallest floor
      expect(el.scrollHeight).toBeLessThanOrEqual(barCap + 1); // the whole message is inside the bar
    }
  });

  it('no size ever shows less of a message than Medium does, at any length the API accepts', () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [3840, 2160]] as const) {
      for (let n = 100; n <= 2000; n += 100) {
        barCap = cap(h);
        const medium = staticText(draw({ mode: 'static', size: 'medium' }, w, message(n)));
        const mediumFits = medium.scrollHeight <= barCap + 1;
        for (const size of ['small', 'large'] as const) {
          const el = staticText(draw({ mode: 'static', size }, w, message(n)));
          if (mediumFits) expect(el.scrollHeight).toBeLessThanOrEqual(barCap + 1);
        }
      }
    }
  });

  it('a message that already fits is left alone: Large stays large, Medium is unchanged', () => {
    barCap = cap(1080);
    // ~400 characters: past 2 lines at Large, well inside the cap at its floor.
    const el = staticText(draw({ mode: 'static', size: 'large' }, 1920, message(400)));
    expect(el.style.fontSize).toBe(`${bannerFontPx('large', 1920).floor}px`);
    // Medium at 2,000 characters fits the cap at its floor: exactly as before.
    expect(staticText(draw({ mode: 'static', size: 'medium' }, 1920, message(2000))).style.fontSize).toBe(`${bannerFontPx('medium', 1920).floor}px`);
  });

  it('on a cap too small for anything it stops at the smallest floor, never below', () => {
    barCap = 60;
    const el = staticText(draw({ mode: 'static', size: 'large' }, 1920, message(2000)));
    expect(el.style.fontSize).toBe(`${bannerFontPx('small', 1920).floor}px`);
  });

  it('a bar that is not height-capped never shrinks past the size floor', () => {
    barCap = 100000;
    expect(staticText(draw({ mode: 'static', size: 'large' }, 1920, message(2000))).style.fontSize).toBe(`${bannerFontPx('large', 1920).floor}px`);
  });
});

describe('scroll speed (one stage width every 30 s / 20 s / 13.3 s)', () => {
  // A copy half a stage wide needs 2 copies to fill the bar: one loop slides
  // both (one stage width), so it takes a whole stage's crossing time.
  it.each([
    [1920, 'slow', 30], [1920, 'normal', 20], [1920, 'fast', 13.3],
    [3840, 'slow', 30], [3840, 'normal', 20], [3840, 'fast', 13.3],
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
      expect(scrollText(draw({ mode: 'scroll', speed: 'slow', size }, 1920)).getAttribute('data-banner-seconds')).toBe('30');
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
