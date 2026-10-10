/**
 * The player's "DRILL — THIS IS A DRILL" banner (2026-10-10).
 *
 * What it must be: unmissable, above every content layer, impossible for
 * operator content to hide, in three languages on the glass, and
 * Taurus-safe (no `inset` shorthand, no four-side object, opaque inline
 * background). And what it must NOT be: present for a live alert.
 */
import { render, screen } from '@testing-library/react';
import { DRILL_BANNER_SUBTEXT, DRILL_BANNER_TEXT, DrillBanner } from '@/components/player/DrillBanner';

describe('DrillBanner', () => {
  it('says DRILL — THIS IS A DRILL in English, Spanish and Chinese', () => {
    render(<DrillBanner />);
    const el = screen.getByTestId('drill-banner');
    expect(el).toHaveTextContent(DRILL_BANNER_TEXT.en);
    expect(el).toHaveTextContent(DRILL_BANNER_TEXT.es);
    expect(el).toHaveTextContent(DRILL_BANNER_TEXT.zh);
    expect(el).toHaveTextContent(DRILL_BANNER_SUBTEXT.en);
    expect(el).toHaveTextContent('THIS IS A DRILL');
    expect(el).toHaveTextContent('Not a real emergency');
  });

  it('sits above every content layer, fixed to the top, opaque indigo, and cannot be clicked away', () => {
    render(<DrillBanner />);
    const el = screen.getByTestId('drill-banner');
    expect(el.className).toMatch(/z-\[10050\]/); // > the message overlay's 9999
    expect(el.className).toMatch(/pointer-events-none/);
    expect(el.style.position).toBe('fixed');
    expect(el.style.top).toBe('0px');
    expect(el.style.backgroundColor).toBe('rgb(49, 46, 129)'); // #312e81, inline so it paints without Tailwind
    expect(el).toHaveAttribute('role', 'status');
  });

  it('is Taurus-safe: no inset shorthand, never all four sides on one object', () => {
    render(<DrillBanner />);
    const el = screen.getByTestId('drill-banner');
    const style = el.getAttribute('style') || '';
    expect(style).not.toMatch(/\binset\b/);
    expect(el.className).not.toMatch(/\binset-/);
    // width + two sides only — can never serialize to the `inset` shorthand
    expect(el.style.right).toBe('');
    expect(el.style.bottom).toBe('');
    expect(el.style.width).toBe('var(--led-w, 100vw)');
  });
});
