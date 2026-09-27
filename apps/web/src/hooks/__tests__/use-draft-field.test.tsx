/**
 * useDraftField (K12-F15 follow-up) — a typed field commits on Enter / blur
 * and CANCELS on Escape. Escape used to SAVE the value it was meant to throw
 * away: the blur it caused ran the commit with a stale "editing" flag.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useDraftField } from '../use-draft-field';
import { Stepper } from '@/components/sports/StatControls';

function Field({ live, onCommit }: { live: string; onCommit: (text: string) => void }) {
  const field = useDraftField(() => live, onCommit);
  return (
    <input
      aria-label="field"
      value={field.draft ?? live}
      onFocus={field.onFocus}
      onChange={(e) => field.onChange(e.target.value)}
      onBlur={field.onBlur}
      onKeyDown={field.onKeyDown}
    />
  );
}

const input = () => screen.getByLabelText('field') as HTMLInputElement;
const focus = (el: HTMLElement) => act(() => el.focus());

describe('useDraftField', () => {
  it('Escape discards the typed text, shows the live value again and writes nothing', () => {
    const onCommit = jest.fn();
    render(<Field live="Central" onCommit={onCommit} />);
    focus(input());
    fireEvent.change(input(), { target: { value: 'Typo' } });
    expect(input().value).toBe('Typo');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input().value).toBe('Central');
    expect(document.activeElement).not.toBe(input());
  });

  it('Enter commits the draft exactly once', () => {
    const onCommit = jest.fn();
    render(<Field live="Central" onCommit={onCommit} />);
    focus(input());
    fireEvent.change(input(), { target: { value: 'Eastside' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Eastside');
  });

  it('tapping away (blur) commits the draft', () => {
    const onCommit = jest.fn();
    render(<Field live="Central" onCommit={onCommit} />);
    focus(input());
    fireEvent.change(input(), { target: { value: 'North' } });
    act(() => input().blur());
    expect(onCommit).toHaveBeenCalledWith('North');
  });

  it('an Escape does not poison the next edit', () => {
    const onCommit = jest.fn();
    render(<Field live="Central" onCommit={onCommit} />);
    focus(input());
    fireEvent.change(input(), { target: { value: 'Typo' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    focus(input());
    expect(input().value).toBe('Central'); // the next edit starts from the live value
    fireEvent.change(input(), { target: { value: 'Westside' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Westside');
  });

  it('keys other than Enter / Escape neither commit nor cancel', () => {
    const onCommit = jest.fn();
    render(<Field live="7" onCommit={onCommit} />);
    focus(input());
    fireEvent.change(input(), { target: { value: '12' } });
    fireEvent.keyDown(input(), { key: 'Tab' });
    fireEvent.keyDown(input(), { key: 'a' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input().value).toBe('12');
  });
});

describe('Stepper type-in (shared by the phone Run view and the pad)', () => {
  const typeIn = () => screen.getByLabelText(/Pitches/, { selector: 'input' }) as HTMLInputElement;

  it('Escape restores the count and sends nothing', () => {
    const onSet = jest.fn();
    render(<Stepper value={42} min={0} max={200} label="Pitches" typeIn onSet={onSet} />);
    focus(typeIn());
    fireEvent.change(typeIn(), { target: { value: '99' } });
    fireEvent.keyDown(typeIn(), { key: 'Escape' });
    expect(onSet).not.toHaveBeenCalled();
    expect(typeIn().value).toBe('42');
  });

  it('Enter sends the clamped count once; an unchanged count sends nothing', () => {
    const onSet = jest.fn();
    render(<Stepper value={42} min={0} max={200} label="Pitches" typeIn onSet={onSet} />);
    focus(typeIn());
    fireEvent.change(typeIn(), { target: { value: '999' } });
    fireEvent.keyDown(typeIn(), { key: 'Enter' });
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenCalledWith(200);

    onSet.mockClear();
    focus(typeIn());
    fireEvent.keyDown(typeIn(), { key: 'Enter' });
    expect(onSet).not.toHaveBeenCalled();
  });
});
