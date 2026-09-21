import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DateField } from '../date-field';

/** Every test runs on Mon 21 Sep 2026, 10:00 local. */
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 8, 21, 10, 0));
});
afterEach(() => {
  jest.useRealTimers();
});

function Harness({
  initial = '',
  min,
  onValue,
}: {
  initial?: string;
  min?: string;
  onValue?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateField
      id="swf-date-start"
      value={value}
      min={min}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
      ariaLabel="Start date"
      placeholder="Start date"
    />
  );
}

const field = () => screen.getByLabelText('Start date') as HTMLInputElement;
const grid = () => screen.getByRole('grid', { name: 'Choose Start date' });
const day = (label: string) => screen.getByRole('gridcell', { name: label });

describe('DateField — typing', () => {
  it('commits 10/12 as this year and re-displays it', () => {
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.change(field(), { target: { value: '10/12' } });
    fireEvent.blur(field());
    expect(onValue).toHaveBeenCalledWith('2026-10-12');
    expect(field().value).toBe('Mon, Oct 12, 2026');
  });

  it('accepts a month name and an explicit year', () => {
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.change(field(), { target: { value: 'Oct 12, 2026' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onValue).toHaveBeenCalledWith('2026-10-12');
  });

  it('a real date before min is refused WITH the range, not called invalid', () => {
    const onValue = jest.fn();
    render(<Harness min="2026-09-21" onValue={onValue} />);
    // 9/1 is behind today, so the parser rolls it to 2027 — force the
    // too-early branch with an explicit year.
    fireEvent.change(field(), { target: { value: '9/1/2026' } });
    fireEvent.blur(field());
    expect(onValue).not.toHaveBeenCalled();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    const hint = document.getElementById(field().getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toBe('Pick Mon, Sep 21, 2026 or later');
    expect(field().value).toBe('9/1/2026');
  });

  it('unreadable text gets the format hint instead', () => {
    render(<Harness min="2026-09-21" />);
    fireEvent.change(field(), { target: { value: 'sometime soon' } });
    fireEvent.blur(field());
    const hint = document.getElementById(field().getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toBe('Try 10/12/2026 or Oct 12');
  });

  it('clearing reports the empty string', () => {
    const onValue = jest.fn();
    render(<Harness initial="2026-10-12" onValue={onValue} />);
    expect(field().value).toBe('Mon, Oct 12, 2026');
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());
    expect(onValue).toHaveBeenCalledWith('');
  });

  it('a host value already below min displays normally and is NOT flagged', () => {
    render(<Harness initial="2025-03-04" min="2026-09-21" />);
    expect(field().value).toBe('Tue, Mar 4, 2025');
    expect(field()).not.toHaveAttribute('aria-invalid');
  });
});

describe('DateField — the calendar', () => {
  it('opens on click with a labelled dialog, 42 day cells and the month header', () => {
    render(<Harness initial="2026-10-12" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    field().focus();
    fireEvent.click(field());
    expect(screen.getByRole('dialog', { name: 'Choose Start date' })).toBeInTheDocument();
    expect(within(grid()).getAllByRole('gridcell')).toHaveLength(42);
    expect(screen.getByText('October 2026')).toBeInTheDocument();
    // Opening must NOT move focus into the calendar — the operator keeps typing.
    expect(document.activeElement).toBe(field());
  });

  it('opens from the calendar button', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Choose date' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('picking a day commits it, closes, and puts focus back in the input', () => {
    const onValue = jest.fn();
    render(<Harness initial="2026-10-12" onValue={onValue} />);
    fireEvent.click(field());
    fireEvent.click(day('Fri, Oct 16, 2026'));
    expect(onValue).toHaveBeenCalledWith('2026-10-16');
    expect(field().value).toBe('Fri, Oct 16, 2026');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it('marks the committed day selected and today with aria-current', () => {
    render(<Harness initial="2026-09-24" />);
    fireEvent.click(field());
    expect(day('Thu, Sep 24, 2026')).toHaveAttribute('aria-selected', 'true');
    expect(day('Mon, Sep 21, 2026')).toHaveAttribute('aria-current', 'date');
  });

  it('prev / next month move the view', () => {
    render(<Harness initial="2026-10-12" />);
    fireEvent.click(field());
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('September 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('November 2026')).toBeInTheDocument();
  });

  it('disables days before min and leaves the rest pickable', () => {
    render(<Harness min="2026-09-21" />);
    fireEvent.click(field());
    expect(day('Sun, Sep 20, 2026')).toBeDisabled();
    expect(day('Mon, Sep 21, 2026')).toBeEnabled();
    expect(day('Tue, Sep 22, 2026')).toBeEnabled();
  });

  it('out-of-month days are still pickable', () => {
    const onValue = jest.fn();
    render(<Harness initial="2026-10-12" onValue={onValue} />);
    fireEvent.click(field());
    const trailing = day('Sun, Nov 1, 2026'); // in the October grid's last row
    expect(trailing).toBeEnabled();
    fireEvent.click(trailing);
    expect(onValue).toHaveBeenCalledWith('2026-11-01');
  });

  it('Today commits today, and is disabled when today is behind min', () => {
    const onValue = jest.fn();
    const { unmount } = render(<Harness onValue={onValue} />);
    fireEvent.click(field());
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onValue).toHaveBeenCalledWith('2026-09-21');
    unmount();

    render(<Harness min="2026-12-01" />);
    fireEvent.click(field());
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
  });

  it('Clear only exists with a value, and empties it', () => {
    const onValue = jest.fn();
    const { unmount } = render(<Harness />);
    fireEvent.click(field());
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    unmount();

    render(<Harness initial="2026-10-12" onValue={onValue} />);
    fireEvent.click(field());
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onValue).toHaveBeenCalledWith('');
    expect(field().value).toBe('');
  });

  it('the inline × clears the field', () => {
    const onValue = jest.fn();
    render(<Harness initial="2026-10-12" onValue={onValue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear date' }));
    expect(onValue).toHaveBeenCalledWith('');
  });

  it('a parseable string previews its month while open', () => {
    render(<Harness />);
    fireEvent.click(field());
    expect(screen.getByText('September 2026')).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: '12/25/2026' } });
    expect(screen.getByText('December 2026')).toBeInTheDocument();
    // …and nothing is committed until Enter/blur.
    expect(field().value).toBe('12/25/2026');
  });

  it('a pointer press outside closes it', () => {
    render(<Harness />);
    fireEvent.click(field());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('DateField — grid keyboard', () => {
  it('ArrowDown from the input opens and moves focus onto the selected day', () => {
    render(<Harness initial="2026-10-12" />);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.activeElement).toBe(day('Mon, Oct 12, 2026'));
  });

  it('arrows walk by a day and a week, crossing the month boundary', () => {
    render(<Harness initial="2026-10-01" />);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(day('Thu, Oct 1, 2026'));
    // Back one day crosses into September and the view follows.
    fireEvent.keyDown(grid(), { key: 'ArrowLeft' });
    expect(screen.getByText('September 2026')).toBeInTheDocument();
    expect(document.activeElement).toBe(day('Wed, Sep 30, 2026'));
    // Forward a week lands back in October.
    fireEvent.keyDown(grid(), { key: 'ArrowDown' });
    expect(screen.getByText('October 2026')).toBeInTheDocument();
    expect(document.activeElement).toBe(day('Wed, Oct 7, 2026'));
    fireEvent.keyDown(grid(), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(day('Wed, Sep 30, 2026'));
    fireEvent.keyDown(grid(), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(day('Thu, Oct 1, 2026'));
  });

  it('Home / End reach the week edges (Sunday-start)', () => {
    render(<Harness initial="2026-10-14" />); // a Wednesday
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(grid(), { key: 'Home' });
    expect(document.activeElement).toBe(day('Sun, Oct 11, 2026'));
    fireEvent.keyDown(grid(), { key: 'End' });
    expect(document.activeElement).toBe(day('Sat, Oct 17, 2026'));
  });

  it('PageUp / PageDown step a month, with Shift stepping a year', () => {
    render(<Harness initial="2026-10-12" />);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(grid(), { key: 'PageDown' });
    expect(document.activeElement).toBe(day('Thu, Nov 12, 2026'));
    fireEvent.keyDown(grid(), { key: 'PageUp' });
    expect(document.activeElement).toBe(day('Mon, Oct 12, 2026'));
    fireEvent.keyDown(grid(), { key: 'PageDown', shiftKey: true });
    expect(screen.getByText('October 2027')).toBeInTheDocument();
  });

  it('Enter on the focused day selects it', () => {
    const onValue = jest.fn();
    render(<Harness initial="2026-10-12" onValue={onValue} />);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(grid(), { key: 'ArrowRight' });
    fireEvent.keyDown(grid(), { key: 'Enter' });
    expect(onValue).toHaveBeenCalledWith('2026-10-13');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it('never lands on a day before min', () => {
    render(<Harness initial="2026-09-21" min="2026-09-21" />);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(day('Mon, Sep 21, 2026'));
    fireEvent.keyDown(grid(), { key: 'ArrowUp' }); // a week back would be Sep 14
    expect(document.activeElement).toBe(day('Mon, Sep 21, 2026'));
  });

  it('Escape in the grid closes and returns focus to the input', () => {
    render(<Harness initial="2026-10-12" />);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(grid(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(field());
  });
});

describe('DateField — Escape is isolated from the host', () => {
  it('closes the popover and does NOT reach a window keydown listener', () => {
    const spy = jest.fn();
    window.addEventListener('keydown', spy);
    try {
      render(<Harness initial="2026-10-12" />);
      fireEvent.click(field());
      fireEvent.change(field(), { target: { value: 'half typed' } });
      fireEvent.keyDown(field(), { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(field().value).toBe('Mon, Oct 12, 2026'); // reverted
      expect(spy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', spy);
    }
  });

  it('with the popover CLOSED, Escape belongs to the host and reaches window', () => {
    const spy = jest.fn();
    window.addEventListener('keydown', spy);
    try {
      render(<Harness initial="2026-10-12" />);
      fireEvent.keyDown(field(), { key: 'Escape' });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', spy);
    }
  });
});
