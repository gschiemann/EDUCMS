/**
 * LIVE | DRILL (2026-10-10) — the switch itself, and the rule that matters:
 * a surface that owns it in `useState(DEFAULT_EMERGENCY_MODE)` comes back LIVE
 * on EVERY mount, whatever was chosen before. Nothing is persisted.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { LiveDrillSwitch } from '@/components/emergency/LiveDrillSwitch';
import { DEFAULT_EMERGENCY_MODE, type EmergencyMode } from '@/lib/emergency-target';

function Surface({ onMode }: { onMode?: (m: EmergencyMode) => void }) {
  const [mode, setMode] = useState<EmergencyMode>(DEFAULT_EMERGENCY_MODE);
  return (
    <LiveDrillSwitch
      mode={mode}
      onChange={(m) => {
        setMode(m);
        onMode?.(m);
      }}
    />
  );
}

describe('LiveDrillSwitch', () => {
  it('defaults to LIVE and says what the next alert will be', () => {
    render(<Surface />);
    expect(screen.getByTestId('emergency-mode-switch')).toHaveAttribute('data-mode', 'live');
    expect(screen.getByTestId('emergency-mode-live')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('emergency-mode-drill')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('emergency-mode-hint')).toHaveTextContent('Real emergency');
  });

  it('flips to DRILL on click and the hint changes', () => {
    const onMode = jest.fn();
    render(<Surface onMode={onMode} />);
    fireEvent.click(screen.getByTestId('emergency-mode-drill'));
    expect(onMode).toHaveBeenCalledWith('drill');
    expect(screen.getByTestId('emergency-mode-switch')).toHaveAttribute('data-mode', 'drill');
    expect(screen.getByTestId('emergency-mode-drill')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('emergency-mode-hint')).toHaveTextContent('Practice only');
  });

  it('comes back LIVE on every mount — a chosen DRILL is never remembered', () => {
    const first = render(<Surface />);
    fireEvent.click(screen.getByTestId('emergency-mode-drill'));
    expect(screen.getByTestId('emergency-mode-switch')).toHaveAttribute('data-mode', 'drill');
    first.unmount();
    render(<Surface />);
    expect(screen.getByTestId('emergency-mode-switch')).toHaveAttribute('data-mode', 'live');
    // and nothing was written anywhere a later open could read
    expect(Object.keys(window.localStorage)).toEqual([]);
    expect(Object.keys(window.sessionStorage)).toEqual([]);
  });

  it('is a labelled radio group with two segments, disabled while a send is in flight', () => {
    render(<LiveDrillSwitch mode="live" onChange={() => {}} disabled />);
    expect(screen.getByRole('radiogroup', { name: 'Alert mode' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByTestId('emergency-mode-drill')).toBeDisabled();
  });
});
