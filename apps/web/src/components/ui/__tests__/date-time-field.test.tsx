import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateTimeField } from '../date-time-field';

/**
 * Every test runs on Mon 21 Sep 2026, 10:00 LOCAL. Nothing here asserts a
 * timezone-dependent value — the component only ever handles local
 * wall-clock strings — but DateField resolves a no-year date against
 * "today", so the clock has to be pinned either way.
 */
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 8, 21, 10, 0));
});
afterEach(() => {
  jest.useRealTimers();
  // matchMedia is deleted, not restored, by the coarse-pointer test below.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

/** The hosts are controlled — mirror that, so a commit really re-renders. */
function Harness({ initial = '', onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateTimeField
        id="ann-expires"
        value={value}
        onChange={(v) => {
          setValue(v);
          onValue?.(v);
        }}
        ariaLabel="Expiration date"
      />
      <output data-testid="host-value">{value}</output>
    </>
  );
}

const dateHalf = () => screen.getByLabelText('Expiration date') as HTMLInputElement;
const timeHalf = () => screen.getByRole('combobox', { name: 'Expiration date time' }) as HTMLInputElement;
const hostValue = () => screen.getByTestId('host-value').textContent;

/** Type into a half and settle it the way a blur would. */
const type = (el: HTMLInputElement, text: string) => {
  fireEvent.change(el, { target: { value: text } });
  fireEvent.blur(el);
};

describe('DateTimeField — the pair', () => {
  it('a typed date + a typed time make one YYYY-MM-DDTHH:MM value', () => {
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);
    type(dateHalf(), '10/12/2026');
    type(timeHalf(), '7:30 pm');
    expect(onValue).toHaveBeenLastCalledWith('2026-10-12T19:30');
    expect(hostValue()).toBe('2026-10-12T19:30');
  });

  it('either half alone reports the empty string, never a half-built value', () => {
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);
    type(dateHalf(), '10/12/2026');
    // The date IS on screen — the operator's typing is not thrown away…
    expect(dateHalf().value).toBe('Mon, Oct 12, 2026');
    // …but the host has nothing it could parse yet.
    expect(onValue).toHaveBeenLastCalledWith('');
    expect(hostValue()).toBe('');
    expect(onValue.mock.calls.every(([v]) => v === '' || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v))).toBe(true);
  });

  it('the same holds for a lone TIME', () => {
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);
    type(timeHalf(), '9am');
    expect(timeHalf().value).toBe('9:00 AM');
    expect(onValue).toHaveBeenLastCalledWith('');
    expect(hostValue()).toBe('');
  });

  it('clearing the TIME half empties the value and KEEPS the date on screen', () => {
    const onValue = jest.fn();
    render(<Harness initial="2026-10-12T19:30" onValue={onValue} />);
    type(timeHalf(), '');
    expect(onValue).toHaveBeenLastCalledWith('');
    expect(hostValue()).toBe('');
    // The regression this guards: the host's own '' echo used to reset both
    // halves, so removing the time silently deleted the date too.
    expect(dateHalf().value).toBe('Mon, Oct 12, 2026');
  });

  it('clearing the DATE half empties the value and KEEPS the time on screen', () => {
    const onValue = jest.fn();
    render(<Harness initial="2026-10-12T19:30" onValue={onValue} />);
    type(dateHalf(), '');
    expect(onValue).toHaveBeenLastCalledWith('');
    expect(hostValue()).toBe('');
    expect(timeHalf().value).toBe('7:30 PM');
  });

  it('re-filling the cleared half rebuilds the value from the half that stayed', () => {
    render(<Harness initial="2026-10-12T19:30" />);
    type(timeHalf(), '');
    type(timeHalf(), '8:15 am');
    expect(hostValue()).toBe('2026-10-12T08:15');
  });
});

describe('DateTimeField — the host still owns the value', () => {
  it('an initial value splits into both halves', () => {
    render(<Harness initial="2026-10-12T19:30" />);
    expect(dateHalf().value).toBe('Mon, Oct 12, 2026');
    expect(timeHalf().value).toBe('7:30 PM');
  });

  it('an empty initial value shows two empty halves', () => {
    render(<Harness />);
    expect(dateHalf().value).toBe('');
    expect(timeHalf().value).toBe('');
  });

  it('a host-driven clear (a "Clear" button) empties BOTH halves', () => {
    function PushHarness({ next }: { next: string }) {
      const [value, setValue] = useState('2026-10-12T19:30');
      return (
        <>
          <DateTimeField id="ann-expires" value={value} onChange={setValue} ariaLabel="Expiration date" />
          <button type="button" onClick={() => setValue(next)}>
            Push
          </button>
        </>
      );
    }
    render(<PushHarness next="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(dateHalf().value).toBe('');
    expect(timeHalf().value).toBe('');
  });

  it('a host-driven REPLACEMENT mid-edit wins over the half being typed', () => {
    function PushHarness() {
      const [value, setValue] = useState('');
      return (
        <>
          <DateTimeField id="ann-expires" value={value} onChange={setValue} ariaLabel="Expiration date" />
          <button type="button" onClick={() => setValue('2026-11-01T08:00')}>
            Push
          </button>
        </>
      );
    }
    render(<PushHarness />);
    type(dateHalf(), '10/12/2026'); // half-filled, host still holds ''
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(dateHalf().value).toBe('Sun, Nov 1, 2026');
    expect(timeHalf().value).toBe('8:00 AM');
  });
});

describe('DateTimeField — coarse pointer', () => {
  it('renders the NATIVE datetime-local, with the same id, on a touch device', () => {
    window.matchMedia = ((q: string) => ({
      matches: q === '(pointer: coarse)',
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;

    const onValue = jest.fn();
    const { container } = render(<Harness initial="2026-10-12T19:30" onValue={onValue} />);

    const native = container.querySelector('#ann-expires') as HTMLInputElement;
    expect(native.tagName).toBe('INPUT');
    expect(native.type).toBe('datetime-local');
    expect(native.value).toBe('2026-10-12T19:30');
    // …and NOT our own controls.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(container.querySelector('#ann-expires-time')).toBeNull();

    fireEvent.change(native, { target: { value: '2026-11-01T08:00' } });
    expect(onValue).toHaveBeenCalledWith('2026-11-01T08:00');
  });
});

describe('DateTimeField — disabled', () => {
  it('locks both halves', () => {
    render(
      <DateTimeField id="ann-expires" value="2026-10-12T19:30" onChange={() => {}} ariaLabel="Expiration date" disabled />,
    );
    expect(dateHalf()).toBeDisabled();
    expect(timeHalf()).toBeDisabled();
  });
});
