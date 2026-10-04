/**
 * SelectionCheckbox — the one box every list selects with (Greg, 2026-10-04).
 *
 * What these lock down:
 *   - it is a REAL checkbox with the accessible name the caller gives it, and
 *     that name never changes with the state (the state is checked / mixed);
 *   - it is tri-state: `indeterminate` is a DOM property React cannot set, so the
 *     component has to, and a checked box is never also "mixed";
 *   - a click reports what the box would become — true from empty OR from the
 *     dash (so the header selects the rest), false from checked;
 *   - a tile's box stays out of the way only while nothing is selected, and only
 *     on a device that can hover.
 */
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  SELECTED_TILE_CLASS,
  SelectionCheckbox,
  SelectionTileCheckbox,
  selectAllTitle,
  selectionState,
} from '../SelectionCheckbox';

describe('selectionState', () => {
  it('is none / some / all by how many of the rows shown are selected', () => {
    expect(selectionState(0, 5)).toBe('none');
    expect(selectionState(2, 5)).toBe('some');
    expect(selectionState(5, 5)).toBe('all');
  });

  it('never claims "all" for an empty list, and tolerates a count that overshoots', () => {
    expect(selectionState(0, 0)).toBe('none');
    expect(selectionState(3, 0)).toBe('none');
    expect(selectionState(6, 5)).toBe('all');
  });
});

describe('SelectionCheckbox', () => {
  it('is a native checkbox named by the label it is given', () => {
    render(<SelectionCheckbox checked={false} label="Select Lobby Welcome" onChange={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Select Lobby Welcome' });
    expect(box.tagName).toBe('INPUT');
    expect(box).not.toBeChecked();
  });

  it('keeps its name when its state changes', () => {
    const { rerender } = render(<SelectionCheckbox checked={false} label="Select all files shown" onChange={() => {}} />);
    rerender(<SelectionCheckbox checked label="Select all files shown" onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Select all files shown' })).toBeChecked();
  });

  it('shows the dash for "some" — through the DOM property, because React cannot set it', () => {
    const { rerender } = render(<SelectionCheckbox checked={false} indeterminate label="all" onChange={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'all' }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box.checked).toBe(false);
    // …and leaves it again when the rest get selected
    rerender(<SelectionCheckbox checked indeterminate={false} label="all" onChange={() => {}} />);
    expect((screen.getByRole('checkbox', { name: 'all' }) as HTMLInputElement).indeterminate).toBe(false);
  });

  it('a checked box is never also "mixed", whatever it is told', () => {
    render(<SelectionCheckbox checked indeterminate label="both" onChange={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'both' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.indeterminate).toBe(false);
  });

  it('reports what it would become: true from empty and from the dash, false from checked', () => {
    const onChange = jest.fn();
    const { rerender } = render(<SelectionCheckbox checked={false} label="box" onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'box' }));
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<SelectionCheckbox checked={false} indeterminate label="box" onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'box' }));
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<SelectionCheckbox checked label="box" onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'box' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('the label around it is the hit area: clicking the label ticks the box', () => {
    const onChange = jest.fn();
    render(<SelectionCheckbox checked={false} label="box" onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'box' }).closest('label') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('is genuinely disabled while a bulk action runs', () => {
    // jsdom still dispatches a synthetic click at a disabled input (a browser never
    // does), so the contract worth locking is that the control IS disabled.
    render(<SelectionCheckbox checked={false} disabled label="box" onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'box' })).toBeDisabled();
  });

  it('carries the test id on the input itself', () => {
    render(<SelectionCheckbox checked={false} label="box" onChange={() => {}} testId="select-page" />);
    expect(screen.getByTestId('select-page')).toBe(screen.getByRole('checkbox', { name: 'box' }));
  });

  it('is 44 px for a finger and 36 px for a mouse on a wide window; compact is 24 px, 44 px for a finger', () => {
    const { rerender } = render(<SelectionCheckbox checked={false} label="box" onChange={() => {}} />);
    const hit = () => screen.getByRole('checkbox', { name: 'box' }).closest('label') as HTMLElement;
    expect(hit().className).toContain('w-11');
    expect(hit().className).toContain('h-11');
    expect(hit().className).toContain('md:pointer-fine:w-9');

    rerender(<SelectionCheckbox checked={false} compact label="box" onChange={() => {}} />);
    expect(hit().className).toContain('w-6');
    expect(hit().className).toContain('pointer-coarse:w-11');
    // the extra reach never changes the row's layout: it is taken back with a negative margin
    expect(hit().className).toContain('pointer-coarse:-m-2.5');
  });
});

describe('the tooltip — what a click will do (Greg, 2026-10-04: "is a bare checkbox understood as select all?")', () => {
  const hit = (name: string) => screen.getByRole('checkbox', { name }).closest('label') as HTMLElement;

  it('selectAllTitle: "select" from none and from some, "clear" from all', () => {
    expect(selectAllTitle('none', 'Select all files shown', 'Clear selection')).toBe('Select all files shown');
    expect(selectAllTitle('some', 'Select all files shown', 'Clear selection')).toBe('Select all files shown');
    expect(selectAllTitle('all', 'Select all files shown', 'Clear selection')).toBe('Clear selection');
  });

  it('a bare box says its own name on hover: the title defaults to the accessible name', () => {
    render(<SelectionCheckbox checked={false} label="Select Lobby Welcome" onChange={() => {}} />);
    expect(hit('Select Lobby Welcome')).toHaveAttribute('title', 'Select Lobby Welcome');
  });

  it('a header box can say something different from its name — the state-aware tooltip', () => {
    const { rerender } = render(
      <SelectionCheckbox checked={false} label="Select all files shown" title={selectAllTitle('none', 'Select all files shown', 'Clear selection')} onChange={() => {}} />,
    );
    expect(hit('Select all files shown')).toHaveAttribute('title', 'Select all files shown');
    rerender(
      <SelectionCheckbox checked={false} indeterminate label="Select all files shown" title={selectAllTitle('some', 'Select all files shown', 'Clear selection')} onChange={() => {}} />,
    );
    expect(hit('Select all files shown')).toHaveAttribute('title', 'Select all files shown');
    rerender(
      <SelectionCheckbox checked label="Select all files shown" title={selectAllTitle('all', 'Select all files shown', 'Clear selection')} onChange={() => {}} />,
    );
    expect(hit('Select all files shown')).toHaveAttribute('title', 'Clear selection');
    // …while the accessible NAME stays what it was: the checkbox carries the state
    expect(screen.getByRole('checkbox', { name: 'Select all files shown' })).toBeChecked();
  });

  it('sits on the label — the whole hit area has it — and not on the input, so a screen reader is not told it twice', () => {
    render(<SelectionCheckbox checked={false} label="Select Lobby Welcome" onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Select Lobby Welcome' })).not.toHaveAttribute('title');
    expect(hit('Select Lobby Welcome').tagName).toBe('LABEL');
  });

  it('a tile\'s box says "Select <name>" on hover', () => {
    render(<SelectionTileCheckbox checked={false} anySelected={false} label="Select Spirit-Week-Poster.png" onChange={() => {}} />);
    expect(hit('Select Spirit-Week-Poster.png')).toHaveAttribute('title', 'Select Spirit-Week-Poster.png');
  });
});

describe('SelectionTileCheckbox', () => {
  const chipOf = () => screen.getByRole('checkbox', { name: 'Select Spirit-Week-Poster.png' }).closest('div') as HTMLElement;

  it('waits for the pointer — on a device that can hover — while nothing is selected', () => {
    render(<SelectionTileCheckbox checked={false} anySelected={false} label="Select Spirit-Week-Poster.png" onChange={() => {}} />);
    expect(chipOf().className).toContain('[@media(hover:hover)]:opacity-0');
    expect(chipOf().className).toContain('[@media(hover:hover)]:group-hover:opacity-100');
    // keyboard focus brings it back too
    expect(chipOf().className).toContain('[@media(hover:hover)]:group-focus-within:opacity-100');
  });

  it('is drawn on EVERY tile as soon as any tile is selected', () => {
    render(<SelectionTileCheckbox checked={false} anySelected label="Select Spirit-Week-Poster.png" onChange={() => {}} />);
    expect(chipOf().className).not.toContain('opacity-0');
  });

  it('is drawn on a selected tile even if the rest of the list is somehow clear', () => {
    render(<SelectionTileCheckbox checked anySelected={false} label="Select Spirit-Week-Poster.png" onChange={() => {}} />);
    expect(chipOf().className).not.toContain('opacity-0');
  });

  it('sits in the tile\'s top-left corner as a white chip', () => {
    render(<SelectionTileCheckbox checked={false} anySelected label="Select Spirit-Week-Poster.png" onChange={() => {}} />);
    expect(chipOf().className).toEqual(expect.stringContaining('absolute top-1 left-1'));
    expect(chipOf().className).toContain('bg-white/90');
  });

  it('is the same checkbox: named, tickable, and reports its next state', () => {
    const onChange = jest.fn();
    render(<SelectionTileCheckbox checked={false} anySelected={false} label="Select Spirit-Week-Poster.png" onChange={onChange} testId="tile-box" />);
    fireEvent.click(screen.getByTestId('tile-box'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('SELECTED_TILE_CLASS', () => {
  it('is one shared definition: an indigo border and a ring — and no background to fight the card\'s own', () => {
    expect(SELECTED_TILE_CLASS).toContain('border-indigo-500');
    expect(SELECTED_TILE_CLASS).toContain('ring-2');
    expect(SELECTED_TILE_CLASS).not.toMatch(/(^|\s)bg-/);
  });
});
