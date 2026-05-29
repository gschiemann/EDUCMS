/**
 * §19 editability fix-wave proof (2026-05-28, Opus 4.8) — Task 4.
 *
 * The 7 formerly-orphan widgets (ANIMATED_BACKGROUND, TOUCH_BUTTON, TOUCH_MENU,
 * ROOM_FINDER, ON_SCREEN_KEYBOARD, WAYFINDING_MAP, QUICK_POLL) used to hit the
 * terminal `return null` in ContentFields → a blank panel ("click it, nothing
 * happens"). This runnable RTL suite mounts the REAL ContentFields switch for
 * each and proves:
 *   - it now renders real fields (the panel is NOT empty / NOT null), and
 *   - editing a field writes the config the widget actually reads, through
 *     updateZone (verified field names against WidgetRenderer.tsx /
 *     AnimatedBackgroundWidget.tsx).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { ContentFields } from '../PropertiesPanel';

function makeZone(widgetType: string, defaultConfig: Record<string, unknown> = {}) {
  return { id: 'orphan-zone', widgetType, defaultConfig };
}

/** Last { defaultConfig } patch handed to updateZone. */
function lastCfg(updateZone: jest.Mock): Record<string, unknown> {
  const calls = updateZone.mock.calls;
  return (calls[calls.length - 1][1].defaultConfig) as Record<string, unknown>;
}

describe('TOUCH_BUTTON — real case (was return null)', () => {
  it('renders an editable label and writes cfg.label', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('TOUCH_BUTTON', { label: 'Tap' })} updateZone={updateZone} />);
    const input = screen.getByDisplayValue('Tap');
    fireEvent.change(input, { target: { value: 'Open menu' } });
    expect(lastCfg(updateZone).label).toBe('Open menu');
  });

  it('exposes button + label color controls (real fields the widget reads)', () => {
    render(<ContentFields zone={makeZone('TOUCH_BUTTON', {})} updateZone={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Button color' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Label color' })).toBeTruthy();
  });
});

describe('TOUCH_MENU — real case', () => {
  it('renders the buttons list editor and writes cfg.buttons', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('TOUCH_MENU', { buttons: [{ label: 'Directory' }] })} updateZone={updateZone} />);
    const input = screen.getByDisplayValue('Directory');
    fireEvent.change(input, { target: { value: 'Map' } });
    const buttons = lastCfg(updateZone).buttons as Array<Record<string, unknown>>;
    expect(buttons[0].label).toBe('Map');
  });

  it('orientation selector writes cfg.orientation', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('TOUCH_MENU', {})} updateZone={updateZone} />);
    // The Layout select is the orientation control.
    const layout = screen.getByDisplayValue('Vertical (stacked)');
    fireEvent.change(layout, { target: { value: 'horizontal' } });
    expect(lastCfg(updateZone).orientation).toBe('horizontal');
  });
});

describe('ON_SCREEN_KEYBOARD — real case', () => {
  it('mode selector writes cfg.mode', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('ON_SCREEN_KEYBOARD', {})} updateZone={updateZone} />);
    const mode = screen.getByDisplayValue('QWERTY (full)');
    fireEvent.change(mode, { target: { value: 'numeric' } });
    expect(lastCfg(updateZone).mode).toBe('numeric');
  });

  it('placeholder field writes cfg.placeholder', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('ON_SCREEN_KEYBOARD', { placeholder: 'Type here…' })} updateZone={updateZone} />);
    fireEvent.change(screen.getByDisplayValue('Type here…'), { target: { value: 'Search…' } });
    expect(lastCfg(updateZone).placeholder).toBe('Search…');
  });
});

describe('ROOM_FINDER — real case', () => {
  it('renders the rooms list editor and writes a room name through cfg.rooms', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('ROOM_FINDER', { rooms: [{ name: 'Room 204', location: '2nd floor' }] })} updateZone={updateZone} />);
    fireEvent.change(screen.getByDisplayValue('Room 204'), { target: { value: 'Room 210' } });
    const rooms = lastCfg(updateZone).rooms as Array<Record<string, unknown>>;
    expect(rooms[0].name).toBe('Room 210');
    expect(rooms[0].location).toBe('2nd floor'); // sibling preserved
  });
});

describe('WAYFINDING_MAP — real case', () => {
  it('renders the hotspots list editor and writes a hotspot label', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('WAYFINDING_MAP', { hotspots: [{ label: 'Office', x: 50, y: 50 }] })} updateZone={updateZone} />);
    fireEvent.change(screen.getByDisplayValue('Office'), { target: { value: 'Gym' } });
    const hs = lastCfg(updateZone).hotspots as Array<Record<string, unknown>>;
    expect(hs[0].label).toBe('Gym');
  });

  it('exposes a map image picker (Browse library)', () => {
    render(<ContentFields zone={makeZone('WAYFINDING_MAP', {})} updateZone={jest.fn()} />);
    expect(screen.getByRole('button', { name: /browse library/i })).toBeTruthy();
  });
});

describe('QUICK_POLL — real case', () => {
  it('writes the question through cfg.question', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('QUICK_POLL', { question: 'Quick poll' })} updateZone={updateZone} />);
    fireEvent.change(screen.getByDisplayValue('Quick poll'), { target: { value: 'Best lunch?' } });
    expect(lastCfg(updateZone).question).toBe('Best lunch?');
  });

  it('renders the options list editor and writes an option label', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('QUICK_POLL', { options: [{ label: 'Pizza', votes: 0 }] })} updateZone={updateZone} />);
    fireEvent.change(screen.getByDisplayValue('Pizza'), { target: { value: 'Tacos' } });
    const opts = lastCfg(updateZone).options as Array<Record<string, unknown>>;
    expect(opts[0].label).toBe('Tacos');
  });
});

describe('ANIMATED_BACKGROUND — real case (textless decoration)', () => {
  it('renders its real knobs (variant + confetti) and writes cfg.confettiCount', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('ANIMATED_BACKGROUND', { confettiCount: 80 })} updateZone={updateZone} />);
    const confetti = screen.getByLabelText(/Confetti density/i);
    fireEvent.change(confetti, { target: { value: '120' } });
    fireEvent.blur(confetti); // NumField commits on blur
    expect(lastCfg(updateZone).confettiCount).toBe(120);
  });

  it('does NOT show a costume font/color block (it has no text)', () => {
    render(<ContentFields zone={makeZone('ANIMATED_BACKGROUND', {})} updateZone={jest.fn()} />);
    // The universal text-style header should be suppressed for this textless
    // widget (it's in MEDIA_ONLY).
    expect(screen.queryByText(/make it your brand/i)).toBeNull();
  });
});

describe('orphans no longer render an EMPTY panel', () => {
  const ORPHANS = ['TOUCH_BUTTON', 'TOUCH_MENU', 'ON_SCREEN_KEYBOARD', 'ROOM_FINDER', 'WAYFINDING_MAP', 'QUICK_POLL', 'ANIMATED_BACKGROUND'];
  it.each(ORPHANS)('%s renders at least one real form control', (type) => {
    const { container } = render(<ContentFields zone={makeZone(type, {})} updateZone={jest.fn()} />);
    // Before the fix these returned null (no fields). Now there is ≥1 input or
    // select or labelled button rendered.
    const controls = container.querySelectorAll('input, select, button');
    expect(controls.length).toBeGreaterThan(0);
  });
});
