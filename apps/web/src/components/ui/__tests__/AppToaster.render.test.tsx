/**
 * Renders the REAL sonner Toaster (not a mock) and raises a real toast, to
 * prove two things the source-level lock in AppToaster.zindex.test.ts can't:
 *
 *   1. `style={{ zIndex: 55 }}` actually lands on the element sonner styles
 *      with its own `z-index: 999999999` rule. Inline style wins (that rule
 *      is not !important), so the emergency overlay stays on top.
 *   2. The toast is announced through a live region rather than appearing
 *      silently for a screen-reader operator.
 */
import { act, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { AppToaster } from '../AppToaster';
import { MUTATION_ERROR_TOAST_ID } from '@/lib/mutation-error-toast';

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

describe('<AppToaster />', () => {
  it('pins the toast list below the emergency overlay (z-index 55)', async () => {
    render(<AppToaster />);
    act(() => {
      toast.error('That change didn\'t save — check your connection and try again.');
    });

    await screen.findByText(/That change didn't save/);

    const list = document.querySelector<HTMLElement>('[data-sonner-toaster]');
    expect(list).not.toBeNull();
    // The inline value beats sonner's own stylesheet rule (999999999).
    expect(list!.style.zIndex).toBe('55');
  });

  it('announces toasts in a polite live region', async () => {
    render(<AppToaster />);
    act(() => {
      toast.error('Something failed.');
    });
    await screen.findByText('Something failed.');

    const region = document.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region!.textContent).toContain('Something failed.');
  });

  it('replaces rather than stacks when the same id is reused', async () => {
    render(<AppToaster />);
    act(() => {
      toast.error('First', { id: MUTATION_ERROR_TOAST_ID });
    });
    await screen.findByText('First');
    act(() => {
      toast.error('Second', { id: MUTATION_ERROR_TOAST_ID });
    });
    await screen.findByText('Second');

    expect(screen.queryByText('First')).toBeNull();
    expect(document.querySelectorAll('[data-sonner-toast]').length).toBe(1);
  });

  it('keeps ONE toast even when a whole burst arrives in a single tick', async () => {
    render(<AppToaster />);
    act(() => {
      for (let i = 1; i <= 6; i++) toast.error(`fail-${i}`, { id: MUTATION_ERROR_TOAST_ID });
    });
    await screen.findByText('fail-6');
    expect(document.querySelectorAll('[data-sonner-toast]').length).toBe(1);
  });
});
