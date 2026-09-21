import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TimeField } from '../time-field';

/** The hosts are controlled — mirror that, so a commit really re-renders. */
function Harness({ initial = '', onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <TimeField
      id="swf-time-start"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
      ariaLabel="Start time"
    />
  );
}

const field = () => screen.getByRole('combobox', { name: 'Start time' }) as HTMLInputElement;

describe('TimeField — typing', () => {
  it('commits a bare 830 as 08:30 on blur and re-displays it', () => {
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.change(field(), { target: { value: '830' } });
    fireEvent.blur(field());
    expect(onValue).toHaveBeenCalledWith('08:30');
    expect(field().value).toBe('8:30 AM');
  });

  it('clearing the field still reports the empty string', () => {
    const onValue = jest.fn();
    render(<Harness initial="08:00" onValue={onValue} />);
    expect(field().value).toBe('8:00 AM');
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());
    expect(onValue).toHaveBeenCalledWith('');
    expect(field().value).toBe('');
  });

  it('refuses garbage: no onChange, aria-invalid, a described hint, text kept', () => {
    const onValue = jest.fn();
    render(<Harness initial="08:00" onValue={onValue} />);
    fireEvent.change(field(), { target: { value: 'lunchtime' } });
    fireEvent.blur(field());
    expect(onValue).not.toHaveBeenCalled();
    expect(field().value).toBe('lunchtime');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    const hintId = field().getAttribute('aria-describedby')!;
    expect(document.getElementById(hintId)!.textContent).toMatch(/8:30 AM or 14:00/);
  });

  it('clears the error state on the next valid commit', () => {
    render(<Harness initial="08:00" />);
    fireEvent.change(field(), { target: { value: 'zzz' } });
    fireEvent.blur(field());
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: '9am' } });
    fireEvent.blur(field());
    expect(field()).not.toHaveAttribute('aria-invalid');
    expect(field().value).toBe('9:00 AM');
  });

  it('commits the typed time, NOT the nearest option', () => {
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.click(field()); // menu open — the nearest option would be 08:00
    fireEvent.change(field(), { target: { value: '8:05' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onValue).toHaveBeenCalledWith('08:05');
    expect(onValue).not.toHaveBeenCalledWith('08:00');
    expect(field().value).toBe('8:05 AM');
  });
});

describe('TimeField — the menu', () => {
  it('opens on click with all 96 quarter-hour options and keeps focus in the input', () => {
    render(<Harness />);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    field().focus();
    fireEvent.click(field());
    const list = screen.getByRole('listbox', { name: 'Start time' });
    expect(within(list).getAllByRole('option')).toHaveLength(96);
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(field());
  });

  it('opens from the trailing button, which is not a tab stop', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Show times' });
    expect(trigger).toHaveAttribute('tabindex', '-1');
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('does not open on tab-focus alone', () => {
    render(<Harness />);
    fireEvent.focus(field());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('ArrowDown then Enter commits an option and tracks aria-activedescendant', () => {
    const onValue = jest.fn();
    render(<Harness initial="08:00" onValue={onValue} />);
    fireEvent.keyDown(field(), { key: 'ArrowDown' }); // opens, active = 08:00
    expect(field().getAttribute('aria-activedescendant')).toBe('swf-time-start-opt-32');
    fireEvent.keyDown(field(), { key: 'ArrowDown' }); // 08:15
    expect(field().getAttribute('aria-activedescendant')).toBe('swf-time-start-opt-33');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onValue).toHaveBeenCalledWith('08:15');
    expect(field().value).toBe('8:15 AM');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('ArrowUp walks back the other way', () => {
    const onValue = jest.fn();
    render(<Harness initial="08:00" onValue={onValue} />);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onValue).toHaveBeenCalledWith('07:45');
  });

  it('clicking an option commits it once — no stray blur-commit behind it', () => {
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.click(field());
    const list = screen.getByRole('listbox');
    const option = within(list).getAllByRole('option')[40]; // 10:00
    // A real click is preceded by mousedown; the panel prevents its default
    // so focus never leaves the input and no blur-commit can fire.
    fireEvent.mouseDown(list);
    fireEvent.click(option);
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue).toHaveBeenCalledWith('10:00');
    expect(field().value).toBe('10:00 AM');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('marks the committed value as the selected option', () => {
    render(<Harness initial="15:30" />);
    fireEvent.click(field());
    const selected = screen.getAllByRole('option', { selected: true });
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toBe('3:30 PM');
  });

  it('typing never filters the list', () => {
    render(<Harness />);
    fireEvent.click(field());
    fireEvent.change(field(), { target: { value: '9' } });
    expect(screen.getAllByRole('option')).toHaveLength(96);
  });

  it('a pointer press outside closes it', () => {
    render(<Harness />);
    fireEvent.click(field());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('TimeField — Escape is isolated from the host', () => {
  it('closes the menu and does NOT reach a window keydown listener', () => {
    const spy = jest.fn();
    window.addEventListener('keydown', spy);
    try {
      render(<Harness initial="08:00" />);
      fireEvent.click(field());
      fireEvent.change(field(), { target: { value: 'halfway typed' } });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      fireEvent.keyDown(field(), { key: 'Escape' });
      expect(screen.queryByRole('listbox')).toBeNull();
      // reverted to the committed value, not left as the half-typed string
      expect(field().value).toBe('8:00 AM');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', spy);
    }
  });

  it('with the menu CLOSED, Escape belongs to the host and reaches window', () => {
    const spy = jest.fn();
    window.addEventListener('keydown', spy);
    try {
      render(<Harness initial="08:00" />);
      fireEvent.keyDown(field(), { key: 'Escape' });
      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.calls[0][0] as KeyboardEvent).key).toBe('Escape');
    } finally {
      window.removeEventListener('keydown', spy);
    }
  });
});
