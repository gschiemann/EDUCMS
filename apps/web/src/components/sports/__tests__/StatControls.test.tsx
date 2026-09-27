/**
 * TeamStatGrid / Stepper — the per-team controls the phone Run view and the
 * volunteer pad share (K12-F15 / F16). Mounted for real against the REAL
 * basketball definition.
 */
import { act, render, screen, fireEvent } from '@testing-library/react';
import { findSport } from '@cms/api-types';
import { TeamStatGrid, Stepper } from '../StatControls';

const BB = findSport('basketball')!;

function grid(overrides: Partial<React.ComponentProps<typeof TeamStatGrid>> = {}) {
  const onStat = jest.fn();
  const onTimeout = jest.fn();
  const props: React.ComponentProps<typeof TeamStatGrid> = {
    def: BB,
    stats: { homeFouls: 7, awayFouls: 2, homeTimeouts: 3, awayTimeouts: 0 },
    homeTeam: 'Central Comets',
    awayTeam: 'Westview Wolves',
    homeColor: '#184a9d',
    awayColor: '#b52032',
    canEdit: () => true,
    onStat,
    onTimeout,
    ...overrides,
  };
  const utils = render(<TeamStatGrid {...props} />);
  return { ...utils, onStat, onTimeout };
}

describe('TeamStatGrid', () => {
  it('renders the sport rows HOME | AWAY with the bonus badge from the shared threshold', () => {
    grid();
    expect(screen.getByRole('group', { name: 'Fouls' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Timeouts' })).toBeInTheDocument();
    expect(screen.getByText('Bonus')).toBeInTheDocument(); // home at 7
  });

  it('+ writes value + 1 for that team; − is disabled at the minimum', () => {
    const { onStat } = grid({ stats: { homeFouls: 0, awayFouls: 2, homeTimeouts: 3, awayTimeouts: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'Increase Westview Wolves Fouls' }));
    expect(onStat).toHaveBeenCalledWith({ awayFouls: 3 });
    expect(screen.getByRole('button', { name: 'Decrease Central Comets Fouls' })).toBeDisabled();
  });

  it('timeout call fires onTimeout for the side; at zero it says so and is disabled', () => {
    const { onTimeout } = grid();
    fireEvent.click(screen.getByRole('button', { name: 'Timeout — Central Comets' }));
    expect(onTimeout).toHaveBeenCalledWith('home');
    const away = screen.getByRole('button', { name: 'Timeout — Westview Wolves' });
    expect(away).toBeDisabled();
    expect(away).toHaveTextContent('No timeouts left');
  });

  it('a clock-operator view (no stats, timeouts only) shows the calls and no steppers', () => {
    grid({ canEdit: () => false });
    expect(screen.getByRole('button', { name: 'Timeout — Central Comets' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Increase/ })).toBeNull();
    // Fouls are not usable at all → the row is not rendered.
    expect(screen.queryByRole('group', { name: 'Fouls' })).toBeNull();
  });

  it('nothing usable → renders nothing', () => {
    const { container } = grid({ canEdit: () => false, onTimeout: undefined });
    expect(container).toBeEmptyDOMElement();
  });

  it('disabled (pad not live) disables every control', () => {
    grid({ disabled: true });
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });
});

describe('Stepper type-in', () => {
  // Real focus (not a synthetic focus event): the field's own Enter / Escape
  // handlers call blur(), and jsdom only dispatches that blur — nested inside
  // the keydown, before React applies any state update — when the element
  // really has focus. That nesting is exactly the browser behaviour the
  // Escape bug lived in.
  function typeInto(onSet: jest.Mock) {
    render(<Stepper value={5} min={0} max={30} label="Home Fouls" onSet={onSet} typeIn />);
    const field = screen.getByRole('textbox', { name: /Home Fouls/ });
    act(() => field.focus());
    return field;
  }

  it('Enter commits a typed value, clamped to the range', () => {
    const onSet = jest.fn();
    const field = typeInto(onSet);
    fireEvent.change(field, { target: { value: '45' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSet).toHaveBeenCalledWith(30);
  });

  it('Escape DISCARDS the typed value — the blur it triggers must not commit it', () => {
    const onSet = jest.fn();
    const field = typeInto(onSet);
    fireEvent.change(field, { target: { value: '12' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(document.activeElement).not.toBe(field);
    expect(onSet).not.toHaveBeenCalled();
    expect(field).toHaveValue('5');
  });

  it('an unchanged value commits nothing', () => {
    const onSet = jest.fn();
    const field = typeInto(onSet);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSet).not.toHaveBeenCalled();
  });
});
