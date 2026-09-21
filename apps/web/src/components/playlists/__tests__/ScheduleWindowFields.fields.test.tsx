/**
 * ScheduleWindowFields — which date/time controls it draws, and the value
 * contract the three hosts depend on.
 *
 * This one sub-form backs the new-playlist wizard's Step 4, the Schedule
 * dialog and the Publish-to-Screens sheet. 2026-09-21 it stopped rendering
 * native date/time inputs on a DESKTOP pointer (Safari's date popup is tiny
 * and unstyleable; its time input has no menu at all) while keeping them on a
 * TOUCH pointer, where the OS picker is already the better control. The hosts
 * serialize `HH:MM` and `YYYY-MM-DD` either way, so that split must never be
 * observable in what they receive.
 */

import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScheduleWindowFields } from '../PlaylistCreateWizard';

type Setters = {
  setTimeStart?: (s: string) => void;
  setStartDate?: (s: string) => void;
};

function Harness({ setTimeStart, setStartDate }: Setters = {}) {
  const [ts, setTs] = React.useState('08:00');
  const [te, setTe] = React.useState('15:00');
  const [sd, setSd] = React.useState('');
  const [ed, setEd] = React.useState('');
  return (
    <ScheduleWindowFields
      days={['Mon', 'Tue']}
      onToggleDay={() => {}}
      timeStart={ts}
      setTimeStart={(v) => {
        setTs(v);
        setTimeStart?.(v);
      }}
      timeEnd={te}
      setTimeEnd={setTe}
      startDate={sd}
      setStartDate={(v) => {
        setSd(v);
        setStartDate?.(v);
      }}
      endDate={ed}
      setEndDate={setEd}
    />
  );
}

const FIELD_IDS = ['swf-time-start', 'swf-time-end', 'swf-date-start', 'swf-date-end'];

/** jsdom ships no matchMedia, so the default render IS the fine-pointer path. */
describe('ScheduleWindowFields — fine pointer (desktop)', () => {
  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  it('renders no native date or time input', () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll('input[type="time"]')).toHaveLength(0);
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(0);
  });

  it('keeps all four element ids the hosts and tests address', () => {
    const { container } = render(<Harness />);
    for (const id of FIELD_IDS) {
      const el = container.querySelector(`#${id}`);
      expect(el).not.toBeNull();
      expect(el!.tagName).toBe('INPUT');
    }
  });

  it('keeps the sr-only labels pointing at those ids', () => {
    const { container } = render(<Harness />);
    for (const [id, text] of [
      ['swf-time-start', 'Start time'],
      ['swf-time-end', 'End time'],
      ['swf-date-start', 'Start date'],
      ['swf-date-end', 'End date'],
    ] as const) {
      const label = container.querySelector(`label[for="${id}"]`);
      expect(label).not.toBeNull();
      expect(label!.textContent).toBe(text);
    }
  });

  it('shows the committed time in 12-hour form', () => {
    const { container } = render(<Harness />);
    expect((container.querySelector('#swf-time-start') as HTMLInputElement).value).toBe('8:00 AM');
    expect((container.querySelector('#swf-time-end') as HTMLInputElement).value).toBe('3:00 PM');
  });

  it('a TYPED time reaches the host setter as HH:MM', () => {
    const setTimeStart = jest.fn();
    const { container } = render(<Harness setTimeStart={setTimeStart} />);
    const input = container.querySelector('#swf-time-start') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '830' } });
    fireEvent.blur(input);
    expect(setTimeStart).toHaveBeenCalledWith('08:30');
  });

  it('a TYPED date reaches the host setter as YYYY-MM-DD', () => {
    const setStartDate = jest.fn();
    const { container } = render(<Harness setStartDate={setStartDate} />);
    const input = container.querySelector('#swf-date-start') as HTMLInputElement;
    // Two years out, so it clears the `min={today}` floor whenever this runs.
    fireEvent.change(input, { target: { value: `12/25/${new Date().getFullYear() + 2}` } });
    fireEvent.blur(input);
    expect(setStartDate).toHaveBeenCalledWith(`${new Date().getFullYear() + 2}-12-25`);
  });

  it('still renders the rest of the sub-form untouched', () => {
    render(<Harness />);
    expect(screen.getByText('Days of week')).toBeInTheDocument();
    expect(screen.getByText('Time of day')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Leave the dates blank/)).toBeInTheDocument();
  });
});

describe('ScheduleWindowFields — coarse pointer (phone / tablet)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes('coarse'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  });
  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  it('keeps the four NATIVE inputs — the OS picker is the better control there', () => {
    const { container } = render(<Harness />);
    const times = container.querySelectorAll('input[type="time"]');
    const dates = container.querySelectorAll('input[type="date"]');
    expect(times).toHaveLength(2);
    expect(dates).toHaveLength(2);
    expect(times[0].id).toBe('swf-time-start');
    expect(times[1].id).toBe('swf-time-end');
    expect(dates[0].id).toBe('swf-date-start');
    expect(dates[1].id).toBe('swf-date-end');
  });

  it('carries the raw 24-hour value, and a 44px touch target', () => {
    const { container } = render(<Harness />);
    const start = container.querySelector('#swf-time-start') as HTMLInputElement;
    expect(start.value).toBe('08:00');
    expect(start.className).toContain('min-h-[44px]');
  });

  it('the native input reports HH:MM to the host unchanged', () => {
    const setTimeStart = jest.fn();
    const { container } = render(<Harness setTimeStart={setTimeStart} />);
    fireEvent.change(container.querySelector('#swf-time-start')!, { target: { value: '09:45' } });
    expect(setTimeStart).toHaveBeenCalledWith('09:45');
  });
});
