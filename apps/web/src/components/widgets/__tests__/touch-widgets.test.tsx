/**
 * Sprint 4 — Touch / Interactive widget tests
 *
 * Covers:
 *  - Rendering of each new widget type
 *  - Touch action dispatch (CustomEvent('edu:touch-action'))
 *  - WCAG 44px hit-target validation helper
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { WidgetPreview } from '../WidgetRenderer';
import { validateTouchHitTargets, MIN_TOUCH_TARGET_PX } from '@/components/template-builder/constants';

function renderWidget(type: string, config: Record<string, unknown> = {}) {
  return render(
    <div style={{ position: 'relative', width: 400, height: 300 }}>
      <WidgetPreview widgetType={type} config={config} width={50} height={50} live={false} />
    </div>,
  );
}

describe('TOUCH_BUTTON', () => {
  it('renders label and icon', () => {
    renderWidget('TOUCH_BUTTON', { label: 'Main Office', icon: 'map-pin' });
    expect(screen.getByRole('button', { name: 'Main Office' })).toBeInTheDocument();
  });

  it('fires edu:touch-action event on click', () => {
    const spy = jest.fn();
    window.addEventListener('edu:touch-action', spy);
    renderWidget('TOUCH_BUTTON', {
      label: 'Go',
      action: { type: 'navigate', target: 'home' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(spy).toHaveBeenCalledTimes(1);
    const evt = spy.mock.calls[0][0] as CustomEvent;
    expect(evt.detail).toEqual({ type: 'navigate', target: 'home' });
    window.removeEventListener('edu:touch-action', spy);
  });

  it('enforces WCAG min-width/height on the pressable', () => {
    renderWidget('TOUCH_BUTTON', { label: 'Tap' });
    const btn = screen.getByRole('button', { name: 'Tap' });
    expect(btn.style.minWidth).toBe(`${MIN_TOUCH_TARGET_PX}px`);
    expect(btn.style.minHeight).toBe(`${MIN_TOUCH_TARGET_PX}px`);
  });
});

describe('TOUCH_MENU', () => {
  it('renders the configured buttons in the chosen orientation', () => {
    renderWidget('TOUCH_MENU', {
      orientation: 'horizontal',
      buttons: [
        { label: 'Classes', action: { type: 'show', target: 'classes' } },
        { label: 'Lunch', action: { type: 'show', target: 'lunch' } },
      ],
    });
    expect(screen.getByTestId('touch-menu')).toHaveAttribute('data-orientation', 'horizontal');
    expect(screen.getByRole('button', { name: 'Classes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lunch' })).toBeInTheDocument();
  });

  it('dispatches the action of the tapped item', () => {
    const spy = jest.fn();
    window.addEventListener('edu:touch-action', spy);
    renderWidget('TOUCH_MENU', {
      buttons: [{ label: 'Pick me', action: { type: 'navigate', target: 'x' } }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pick me' }));
    expect(spy).toHaveBeenCalled();
    window.removeEventListener('edu:touch-action', spy);
  });
});

describe('ROOM_FINDER', () => {
  it('renders the room list and is tagged for touch', () => {
    renderWidget('ROOM_FINDER', {
      rooms: [
        { name: 'Room 101', location: 'North Hall' },
        { name: 'Library', location: '2nd Floor' },
      ],
    });
    expect(screen.getByTestId('room-finder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select Room 101/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select Library/ })).toBeInTheDocument();
  });
});

describe('ON_SCREEN_KEYBOARD', () => {
  it('renders a QWERTY keyboard by default', () => {
    renderWidget('ON_SCREEN_KEYBOARD');
    const kb = screen.getByTestId('on-screen-keyboard');
    expect(kb).toHaveAttribute('data-mode', 'qwerty');
    expect(screen.getByRole('button', { name: 'Key Q' })).toBeInTheDocument();
  });

  it('renders numeric mode when configured', () => {
    renderWidget('ON_SCREEN_KEYBOARD', { mode: 'numeric' });
    expect(screen.getByTestId('on-screen-keyboard')).toHaveAttribute('data-mode', 'numeric');
    expect(screen.getByRole('button', { name: 'Key 1' })).toBeInTheDocument();
  });
});

describe('WAYFINDING_MAP', () => {
  it('renders hotspots as 44px round buttons', () => {
    renderWidget('WAYFINDING_MAP', {
      mapImageUrl: '/fake-map.png',
      hotspots: [{ x: 30, y: 40, label: 'Gym', roomId: 'gym' }],
    });
    expect(screen.getByTestId('wayfinding-map')).toBeInTheDocument();
    const spot = screen.getByTestId('hotspot-0') as HTMLButtonElement;
    expect(spot.style.width).toBe(`${MIN_TOUCH_TARGET_PX}px`);
    expect(spot.style.height).toBe(`${MIN_TOUCH_TARGET_PX}px`);
  });
});

describe('QUICK_POLL', () => {
  it('shows the question and options', () => {
    renderWidget('QUICK_POLL', {
      question: 'Best lunch?',
      options: [{ label: 'Pizza' }, { label: 'Tacos' }],
    });
    expect(screen.getByText('Best lunch?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vote for Pizza' })).toBeInTheDocument();
  });

  it('locks additional votes after one click (local-only)', () => {
    renderWidget('QUICK_POLL', {
      question: 'Q',
      options: [{ label: 'A' }, { label: 'B' }],
    });
    const a = screen.getByRole('button', { name: 'Vote for A' });
    fireEvent.click(a);
    // After vote, percentages show
    expect(screen.getByText(/Thanks for voting/)).toBeInTheDocument();
  });
});

describe('validateTouchHitTargets', () => {
  const base = { id: 'z1', name: 'Z', x: 0, y: 0, zIndex: 0 };

  it('flags zones smaller than 44px at target resolution', () => {
    const result = validateTouchHitTargets(
      [{ ...base, widgetType: 'TOUCH_BUTTON', width: 1, height: 1 }], // 1% of 1920 = 19.2px
      1920,
      1080,
    );
    expect(result.ok).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].zoneId).toBe('z1');
  });

  it('passes zones that meet the 44px minimum', () => {
    const result = validateTouchHitTargets(
      [{ ...base, widgetType: 'TOUCH_BUTTON', width: 10, height: 10 }], // 192×108px
      1920,
      1080,
    );
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('ignores non-interactive zones', () => {
    const result = validateTouchHitTargets(
      [{ ...base, widgetType: 'CLOCK', width: 1, height: 1 }],
      1920,
      1080,
    );
    expect(result.ok).toBe(true);
  });

  it('validates any zone with a touchAction regardless of widget type', () => {
    const result = validateTouchHitTargets(
      [{
        ...base,
        widgetType: 'IMAGE',
        width: 1,
        height: 1,
        touchAction: { type: 'navigate', target: 'x' },
      }],
      1920,
      1080,
    );
    expect(result.ok).toBe(false);
  });
});
