/**
 * FleetLiveSummary (2026-10-12) — the map's live summary card. The counts and
 * the alert priority are pinned in fleet-map/__tests__/mapAlerts.test.ts;
 * FleetCommandCenter.test.tsx and fleetMapParity.test.tsx prove it is mounted
 * on both maps. This suite pins the card's own behaviour: plural copy, the
 * chips toggling the map filter, and every alert row being a door.
 */
import * as React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FleetLiveSummary } from '../FleetLiveSummary';
import { summarizeMapAlerts, type MapAlertScreen, type MapPlace } from '@/components/fleet-map/mapAlerts';

const NOW = Date.parse('2026-10-12T12:00:00Z');

function s(id: string, state: MapAlertScreen['grade']['state'], over: Partial<MapAlertScreen> = {}): MapAlertScreen {
  return {
    id, name: id, status: state === 'offline' ? 'OFFLINE' : 'ONLINE', lastPingAt: null, lastRenderedAt: null,
    grade: { state, appUpdating: false, pushSentAtMs: null },
    ...over,
  };
}
function place(id: string, name: string, screens: MapAlertScreen[], over: Partial<MapPlace> = {}): MapPlace {
  return { id, name, screens, pushStale: 0, emergencyGap: null, ...over };
}

describe('<FleetLiveSummary>', () => {
  it('pluralises correctly — "1 screen hasn’t", never "1 screen … haven’t"', () => {
    const summary = summarizeMapAlerts([place('cle', 'RIOT Cleveland', [s('a', 'playing'), s('b', 'playing'), s('c', 'behind')])]);
    render(<FleetLiveSummary summary={summary} filter="all" onFilter={jest.fn()} onAlert={jest.fn()} now={NOW} />);
    expect(screen.getByText('3 screens')).toBeInTheDocument();
    expect(screen.getByText('2 playing')).toBeInTheDocument();
    expect(screen.getByText('1 screen hasn’t confirmed the update it was sent.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 update not confirmed' })).toBeInTheDocument();
  });

  it('says when the offline screens went quiet and toggles the map filter', () => {
    const onFilter = jest.fn();
    const summary = summarizeMapAlerts([
      place('hou', 'Houston', [
        s('a', 'offline', { lastPingAt: '2026-10-12T09:00:00Z' }),
        s('b', 'offline'),
      ]),
    ]);
    const { rerender } = render(
      <FleetLiveSummary summary={summary} filter="all" onFilter={onFilter} onAlert={jest.fn()} now={NOW} />,
    );
    expect(screen.getByText('0 playing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2 offline (since 3 hours ago)' }));
    expect(onFilter).toHaveBeenCalledWith('offline');
    rerender(<FleetLiveSummary summary={summary} filter="offline" onFilter={onFilter} onAlert={jest.fn()} now={NOW} />);
    const chip = screen.getByRole('button', { name: '2 offline (since 3 hours ago)' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(onFilter).toHaveBeenLastCalledWith('all');
  });

  it('lists EVERY location with the problem, each one a door to its fix', () => {
    const onAlert = jest.fn();
    const summary = summarizeMapAlerts([
      place('cle', 'RIOT Cleveland', [s('a', 'behind')]),
      place('hou', 'RIOT Houston', [s('b', 'behind'), s('c', 'behind')]),
      place('chi', 'RIOT Chicago', [s('d', 'playing')]),
    ]);
    render(<FleetLiveSummary summary={summary} filter="drift" onFilter={jest.fn()} onAlert={onAlert} now={NOW} />);
    expect(screen.getByText('3 screens haven’t confirmed the update they were sent.')).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Where to fix it' })).getAllByRole('button');
    // Worst first.
    expect(rows.map((r) => r.textContent)).toEqual(['RIOT Houston · 2 screensFix', 'RIOT Cleveland · 1 screenFix']);
    fireEvent.click(rows[1]);
    expect(onAlert).toHaveBeenCalledWith('drift', 'cle');
  });

  it('a calm, self-healing state is visible but never an alert', () => {
    const summary = summarizeMapAlerts([
      place('hou', 'RIOT Houston', [
        s('a', 'playing', { grade: { state: 'playing', appUpdating: true, pushSentAtMs: null } }),
        s('b', 'syncing'),
      ]),
    ]);
    render(<FleetLiveSummary summary={summary} filter="all" onFilter={jest.fn()} onAlert={jest.fn()} now={NOW} />);
    expect(screen.getByText('1 screen is playing on the previous web player — it updates itself.')).toBeInTheDocument();
    expect(screen.getByText('1 screen is confirming an update it was just sent.')).toBeInTheDocument();
    expect(screen.getByText('Everything is playing. Nothing needs you right now.')).toBeInTheDocument();
  });

  it('says plainly when nothing needs anyone, and when there is nothing at all', () => {
    const { rerender } = render(
      <FleetLiveSummary summary={summarizeMapAlerts([place('x', 'X', [s('a', 'playing')])])} filter="all" onFilter={jest.fn()} onAlert={jest.fn()} now={NOW} />,
    );
    expect(screen.getByText('Everything is playing. Nothing needs you right now.')).toBeInTheDocument();
    rerender(<FleetLiveSummary summary={summarizeMapAlerts([])} filter="all" onFilter={jest.fn()} onAlert={jest.fn()} now={NOW} />);
    expect(screen.getByText('No screens here yet.')).toBeInTheDocument();
  });
});
