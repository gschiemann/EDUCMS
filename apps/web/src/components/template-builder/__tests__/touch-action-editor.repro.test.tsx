/**
 * TouchMaker repro — operator complaint 2026-05-28:
 *   "Our TouchMaker, Touch interactive screen template maker doesn't
 *    work right. Nothing has the ability to be functional."
 *
 * This drives the REAL operator flow through the full PropertiesPanel:
 *   1. Template is touch-enabled, a TOUCH_POINT zone is selected.
 *   2. Operator picks a Tap Action (e.g. "Open a website").
 *   3. Operator types the target URL.
 *   4. Operator edits the touch-point's visible label.
 * Then asserts each step lands on `zone.touchAction` / `defaultConfig`
 * in the builder store (the value the save path serializes + the
 * player runtime reads).
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The target picker pulls templates + assets via React Query. In a
// unit test we don't want real network — stub the hooks so the picker
// renders its dropdowns deterministically.
jest.mock('@/hooks/use-api', () => ({
  useAssets: () => ({ data: [] }),
  usePlaylists: () => ({ data: [] }),
  useTemplates: () => ({ data: [] }),
  useTemplateBackdrops: () => ({ data: [] }),
}));

import { PropertiesPanel } from '../PropertiesPanel';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

function seedTouchPointZone(): Zone {
  return {
    id: 'tp-1',
    name: 'Tap target',
    widgetType: 'TOUCH_POINT',
    x: 10,
    y: 10,
    width: 20,
    height: 20,
    zIndex: 1,
    sortOrder: 0,
    defaultConfig: { variant: 'tap-prompt', bgColor: 'transparent' },
    touchAction: null,
  };
}

function mountPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PropertiesPanel />
    </QueryClientProvider>,
  );
}

describe('TouchMaker — TapAction editor end-to-end (repro)', () => {
  beforeEach(() => {
    // Seed a touch-enabled template with one selected TOUCH_POINT.
    act(() => {
      useBuilderStore.getState().init({
        id: 'tmpl-1',
        isSystem: false,
        zones: [seedTouchPointZone()],
        meta: {
          name: 'Sample Touch',
          description: '',
          screenWidth: 1920,
          screenHeight: 1080,
          bgColor: '',
          bgGradient: '',
          bgImage: '',
        },
        isTouchEnabled: true,
        idleResetMs: 60000,
        scenes: [],
      });
      useBuilderStore.getState().select('tp-1');
    });
  });

  // The "Do this" action-type <select> is the heart of the TouchMaker.
  // After the a11y fix it's addressable by accessible name (label is
  // now associated via htmlFor/id + aria-label).
  function getActionSelect(): HTMLSelectElement {
    return screen.getByRole('combobox', { name: /do this when a visitor taps/i }) as HTMLSelectElement;
  }

  it('exposes the action-type select with an accessible name (a11y fix)', () => {
    mountPanel();
    // Regression guard: before the fix, getByRole('combobox', {name})
    // threw "Unable to find an accessible element" — the <label> was
    // visually adjacent but not programmatically associated.
    expect(getActionSelect()).toBeInTheDocument();
  });

  it('lets the operator set a Tap Action TYPE and it lands on zone.touchAction', () => {
    mountPanel();

    const actionSelect = getActionSelect();
    expect(actionSelect).toBeInTheDocument();

    act(() => {
      fireEvent.change(actionSelect, { target: { value: 'open-url' } });
    });

    const action = useBuilderStore.getState().zones[0].touchAction;
    expect(action).not.toBeNull();
    expect(action?.type).toBe('open-url');
  });

  it('lets the operator type a target URL and it flows through to zone.touchAction.target', () => {
    mountPanel();

    const actionSelect = getActionSelect();
    act(() => {
      fireEvent.change(actionSelect, { target: { value: 'open-url' } });
    });

    // open-url uses the 'url' picker → a text input with the URL label.
    const urlInput = screen.getByPlaceholderText('https://example.com') as HTMLInputElement;
    act(() => {
      fireEvent.change(urlInput, { target: { value: 'https://venueos.example' } });
    });

    const action = useBuilderStore.getState().zones[0].touchAction as any;
    expect(action.type).toBe('open-url');
    expect(action.target).toBe('https://venueos.example');
  });

  it('lets the operator edit the touch-point LABEL and it lands on defaultConfig.label', () => {
    mountPanel();

    // tap-prompt is a labeled variant → "Button label" field renders.
    const labelInput = screen.getByPlaceholderText('Tap to continue') as HTMLInputElement;
    act(() => {
      fireEvent.change(labelInput, { target: { value: 'Start here' } });
    });

    const cfg = useBuilderStore.getState().zones[0].defaultConfig as any;
    expect(cfg.label).toBe('Start here');
  });
});
