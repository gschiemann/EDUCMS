/**
 * FleetLiveSummary (2026-10-12) — the map's live summary. The pure counts and
 * the "do this first" priority are pinned here; FleetCommandCenter.test.tsx
 * proves it is mounted and that its counts filter the map.
 */
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FleetLiveSummary, summarizeLiveFleet } from '../FleetLiveSummary';
import type { LocationRow } from '../fleetCommand';

function row(over: Partial<LocationRow>): LocationRow {
  return {
    tenantId: 'x', name: 'X', slug: 'x', isSelf: false,
    screensTotal: 1, screensOnline: 1, screensOffline: 0, notPainting: 0,
    readiness: 'READY', missingTypes: [], lockdownWired: true, emergencyEnabled: true,
    emergencyVerticalStated: true, pendingApprovals: 0, needsAttention: false,
    contentBehind: 0, pushStale: 0, emergencyCached: 0, hasScreens: true,
    ...over,
  } as LocationRow;
}

const NOW = Date.parse('2026-10-12T12:00:00Z');

describe('summarizeLiveFleet', () => {
  it('counts only the locations shown and dates the oldest offline screen', () => {
    const rows = [row({ tenantId: 'hou', name: 'Houston', screensOffline: 2 })];
    const s = summarizeLiveFleet(rows, [
      { tenantId: 'hou', status: 'OFFLINE', lastPingAt: '2026-10-12T09:00:00Z', needsAttention: true },
      { tenantId: 'hou', status: 'OFFLINE', lastPingAt: '2026-10-12T11:00:00Z', needsAttention: true },
      { tenantId: 'hou', status: 'ONLINE', needsAttention: false },
      { tenantId: 'chi', status: 'OFFLINE', lastPingAt: '2026-10-01T00:00:00Z', needsAttention: true },
    ]);
    expect(s.total).toBe(3);
    expect(s.playing).toBe(1);
    expect(s.offline).toBe(2);
    expect(s.offlineSinceMs).toBe(Date.parse('2026-10-12T09:00:00Z'));
    expect(s.action).toEqual({ kind: 'offline', count: 2, tenantId: 'hou', location: 'Houston' });
  });

  it('ranks offline > no picture > emergency gap > needs update, and is null when all is well', () => {
    const dark = row({ tenantId: 'a', name: 'A', notPainting: 1 });
    const gap = row({ tenantId: 'b', name: 'B', readiness: 'NOT_CONFIGURED' });
    const drift = row({ tenantId: 'c', name: 'C', contentBehind: 3 });
    expect(summarizeLiveFleet([drift, gap, dark], []).action?.kind).toBe('dark');
    expect(summarizeLiveFleet([drift, gap], []).action?.kind).toBe('emergency');
    expect(summarizeLiveFleet([drift], []).action).toEqual({ kind: 'drift', count: 3, tenantId: 'c', location: 'C' });
    // A screenless location's missing alert content is setup, not an alarm.
    expect(summarizeLiveFleet([row({ readiness: 'NOT_CONFIGURED', hasScreens: false })], []).action).toBeNull();
  });
});

describe('<FleetLiveSummary>', () => {
  it('says when the offline screens went quiet and toggles the map filter', () => {
    const onFilter = jest.fn();
    const onSelect = jest.fn();
    const summary = summarizeLiveFleet(
      [row({ tenantId: 'hou', name: 'Houston', screensOffline: 2 })],
      [
        { tenantId: 'hou', status: 'OFFLINE', lastPingAt: '2026-10-12T09:00:00Z', needsAttention: true },
        { tenantId: 'hou', status: 'OFFLINE', lastPingAt: null, needsAttention: true },
      ],
    );
    const { rerender } = render(
      <FleetLiveSummary summary={summary} filter="all" onFilter={onFilter} onSelectLocation={onSelect} now={NOW} />,
    );
    expect(screen.getByText('0 playing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2 offline (since 3 hours ago)' }));
    expect(onFilter).toHaveBeenCalledWith('offline');
    rerender(<FleetLiveSummary summary={summary} filter="offline" onFilter={onFilter} onSelectLocation={onSelect} now={NOW} />);
    const chip = screen.getByRole('button', { name: '2 offline (since 3 hours ago)' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(onFilter).toHaveBeenLastCalledWith('all');
    fireEvent.click(screen.getByRole('button', { name: /2 screens offline at Houston — check power and network/ }));
    expect(onSelect).toHaveBeenCalledWith('hou');
  });

  it('says plainly when nothing needs anyone', () => {
    render(
      <FleetLiveSummary
        summary={summarizeLiveFleet([row({})], [{ tenantId: 'x', status: 'ONLINE', needsAttention: false }])}
        filter="all" onFilter={() => {}} onSelectLocation={() => {}}
      />,
    );
    expect(screen.getByText('Everything is playing. Nothing needs you right now.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
