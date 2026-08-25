/**
 * Render-level proof of the blast-radius contract.
 *
 * `blast-radius.test.ts` next door proves the MATHS; this one proves the
 * operator actually SEES it — that a picked group of 3 renders the words
 * "Publishes to 3 screens across 1 group" with the three real names one tap
 * away, and that a zero-reach selection renders an amber warning rather than
 * a confident-looking summary. That gap ("green CI, nothing changed in the
 * operator's UI") is CLAUDE.md §9's named failure mode, so it gets its own
 * assertions.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent } from '@testing-library/react';
import { computeBlastRadius, reachWarnings } from '@/lib/blast-radius';
import { BlastRadiusSummary, BLAST_COLLAPSE_ABOVE } from '../BlastRadiusSummary';

const GROUPS = [
  {
    id: 'g1',
    name: 'Lobby',
    screens: [
      { id: 's1', name: 'Lobby North' },
      { id: 's2', name: 'Lobby South' },
      { id: 's3', name: 'Cafeteria' },
    ],
  },
  { id: 'g2', name: 'Annex', screens: [] },
];
const SCREENS = GROUPS.flatMap((g) => g.screens);

describe('BlastRadiusSummary', () => {
  it('shows the resolved reach for a picked group of 3, names expanded', () => {
    const radius = computeBlastRadius({
      screens: SCREENS,
      groups: GROUPS,
      selectedScreenIds: ['s1', 's2', 's3'],
      selectedGroupIds: ['g1'],
    });
    render(<BlastRadiusSummary radius={radius} warnings={reachWarnings(radius)} />);

    expect(rtl.getByText('Publishes to 3 screens across 1 group')).toBeInTheDocument();
    // 3 ≤ BLAST_COLLAPSE_ABOVE → the names are already on screen, no tap needed.
    expect(rtl.getByRole('button', { name: /Hide the list/ })).toHaveAttribute('aria-expanded', 'true');
    expect(rtl.getByText('Lobby North · Lobby South · Cafeteria')).toBeInTheDocument();
    expect(rtl.getByText('3 screens')).toBeInTheDocument();
    // Information, not a nag: no warnings for a healthy selection.
    expect(rtl.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('collapses the list above the threshold and expands on tap', () => {
    const many = Array.from({ length: BLAST_COLLAPSE_ABOVE + 4 }, (_, i) => ({
      id: `m${i}`,
      name: `Screen ${i}`,
    }));
    const radius = computeBlastRadius({
      screens: many,
      groups: [],
      selectedScreenIds: many.map((s) => s.id),
    });
    render(<BlastRadiusSummary radius={radius} />);

    expect(rtl.getByText(`Publishes to ${many.length} screens`)).toBeInTheDocument();
    expect(rtl.queryByText(/Screen 0 · Screen 1/)).not.toBeInTheDocument();

    const toggle = rtl.getByRole('button', { name: /Show which screens/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Mobile tap target — the bottom-sheet publish flow renders this too.
    expect(toggle.className).toContain('min-h-[44px]');

    fireEvent.click(toggle);
    expect(rtl.getByText(/Screen 0 · Screen 1/)).toBeInTheDocument();
  });

  it('warns in amber when the selection reaches nothing', () => {
    const radius = computeBlastRadius({ screens: SCREENS, groups: GROUPS, selectedGroupIds: ['g2'] });
    render(<BlastRadiusSummary radius={radius} warnings={reachWarnings(radius)} />);

    expect(rtl.getByText('Publishes to 0 screens across 1 group')).toBeInTheDocument();
    expect(rtl.getByText(/Annex has no screens/)).toBeInTheDocument();
    expect(rtl.getByText(/no screens picked/)).toBeInTheDocument();
    expect(rtl.getByText('no screens')).toBeInTheDocument();
  });

  it('renders the blocking zero-day warning as a live alert', () => {
    const radius = computeBlastRadius({
      screens: SCREENS,
      groups: GROUPS,
      selectedScreenIds: ['s1'],
    });
    const warnings = reachWarnings(radius, { windowed: true, days: [], alwaysLabel: 'Always (24/7)' });
    render(<BlastRadiusSummary radius={radius} warnings={warnings} />);

    const alert = rtl.getByRole('alert');
    expect(alert).toHaveTextContent('no days selected');
    expect(alert).toHaveTextContent('Always (24/7)');
  });

  it('says "locations" for the HQ fleet path', () => {
    const radius = computeBlastRadius({
      screens: SCREENS,
      groups: [
        { id: 'loc1', name: 'Store 1', screens: [{ id: 's1', name: 'Lobby North' }] },
        { id: 'loc2', name: 'Store 2', screens: [{ id: 's3', name: 'Cafeteria' }] },
      ],
      selectedScreenIds: ['s1', 's3'],
      groupMode: 'containing',
    });
    render(<BlastRadiusSummary radius={radius} groupNoun="location" />);
    expect(rtl.getByText('Publishes to 2 screens across 2 locations')).toBeInTheDocument();
    expect(rtl.getByText('Store 1')).toBeInTheDocument();
    expect(rtl.getByText('Store 2')).toBeInTheDocument();
  });
});
