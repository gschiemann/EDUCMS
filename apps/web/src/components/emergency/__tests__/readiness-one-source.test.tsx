/**
 * Muse beta DEV-002 (2026-10-07): the readiness header said "wired" while the
 * per-type rail said "No content" for the same type — two sources. Both now
 * read the one readiness report, and drill content is its own line, never
 * mixed into live.
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiFetch: (p: string) => apiFetch(p) }));

import { AlertTypeRail } from '../AlertTypeRail';
import { EmergencyReadinessCard, type ReadinessReport } from '../EmergencyReadinessCard';

const KINDS = ['lockdown', 'evacuate', 'medical', 'secure', 'weather', 'hold'] as const;

const report: ReadinessReport = {
  verdict: 'NEEDS_ATTENTION',
  score: 70,
  computedAt: '2026-10-11T00:00:00Z',
  items: [
    { key: 'content', status: 'warn', label: 'Alert content wired', detail: '1 of 6 alert types have content.', fixHint: '' },
    { key: 'screens', status: 'ok', label: 'Screens online', detail: '4 of 4 screens online; 4 of them reported playback in the last 5 minutes.', fixHint: '' },
  ],
  contentByType: KINDS.map((kind) => ({
    kind, label: kind, required: true,
    liveItems: kind === 'lockdown' ? 2 : 0,
    drillItems: kind === 'hold' ? 1 : 0,
  })),
  drillContent: { typesWithDrillContent: 1, typesTotal: 6, detail: '1 of 6 alert types have their own drill content.' },
};

it('the rail shows exactly the types the report counts as having live content', () => {
  render(<AlertTypeRail report={report} loading={false} kinds={KINDS} />);
  // Header says 1 of 6 → the rail shows exactly one Configured.
  expect(screen.getAllByText('Configured')).toHaveLength(1);
  expect(screen.getAllByText('No content')).toHaveLength(5);
  // Drill content (hold) is its own module, and does not flip hold to Configured.
  expect(screen.getByText('Drill content')).toBeInTheDocument();
  expect(screen.getByText('1 of 6 types')).toBeInTheDocument();
});

it('without a report the rail says Checking / Unknown, never "No content"', () => {
  const { rerender } = render(<AlertTypeRail report={undefined} loading kinds={KINDS} />);
  expect(screen.getAllByText('Checking')).toHaveLength(6);
  expect(screen.queryByText('No content')).not.toBeInTheDocument();
  rerender(<AlertTypeRail report={undefined} loading={false} kinds={KINDS} />);
  expect(screen.getAllByText('Unknown')).toHaveLength(6);
});

it('the summary card lists drill content on a separate, ungraded line', async () => {
  apiFetch.mockResolvedValue(report);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EmergencyReadinessCard />
    </QueryClientProvider>,
  );
  const line = await screen.findByTestId('readiness-drill-line');
  expect(line).toHaveTextContent('Drill content (not graded):');
  expect(screen.getByText('Screens online:')).toBeInTheDocument();
});
