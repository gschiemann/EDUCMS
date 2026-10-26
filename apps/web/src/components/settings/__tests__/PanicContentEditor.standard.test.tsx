/**
 * Every alert type is ready on day 1 (2026-10-26, owner decision 2 of the
 * Settings simplification): with no picture or video of its own, a LIVE alert
 * card says "Standard message" and previews the exact words the screens show
 * — the same words the manifest's fallback board uses (@cms/api-types
 * emergency-wording.ts). Own content replaces the preview; a drill card never
 * shows the live words.
 */
import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import { standardEmergencyWording } from '@cms/api-types';
import { PanicContentEditor } from '../PanicContentEditor';

let items: unknown[] = [];
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock('@/store/ui-store', () => ({ useUIStore: { getState: () => ({ token: null }) } }));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn() }));
jest.mock('@/lib/upload-accept', () => ({
  ALERT_CONTENT_ACCEPT: 'image/*',
  uploadProblemFor: () => null,
  useUploadProblemText: () => () => '',
}));
jest.mock('@/hooks/use-api', () => ({
  usePanicContent: () => ({ data: { items }, isLoading: false }),
  useAddPanicAsset: () => ({ mutate: jest.fn() }),
  useRemovePanicAsset: () => ({ mutate: jest.fn() }),
}));

beforeEach(() => {
  items = [];
});

it.each(['lockdown', 'secure', 'hold', 'evacuate', 'weather', 'medical'] as const)(
  'a live %s card with no content of its own is ready and previews the standard words',
  (kind) => {
    render(<PanicContentEditor kind={kind} mode="live" accent="red" label={kind} />);
    expect(screen.getByTestId(`alert-status-${kind}`)).toHaveTextContent('Standard message');
    const preview = screen.getByTestId(`standard-wording-${kind}`);
    const words = standardEmergencyWording(kind, 'en');
    expect(within(preview).getByText(words.headline)).toBeInTheDocument();
    for (const line of words.lines) expect(within(preview).getByText(line)).toBeInTheDocument();
    expect(preview).toHaveTextContent('Screens show this until you add your own picture or video.');
  },
);

it('own content replaces the preview and is counted per screen shape', () => {
  items = [{ id: 'i1', durationMs: 10000, asset: { originalName: 'lockdown.png', mimeType: 'image/png', fileUrl: '/x.png' } }];
  render(<PanicContentEditor kind="lockdown" mode="live" accent="red" label="Lockdown" />);
  expect(screen.queryByTestId('standard-wording-lockdown')).toBeNull();
  expect(screen.getByTestId('alert-status-lockdown')).toHaveTextContent('Your content · 1 landscape · 1 portrait');
  // Remove is always reachable — not a hover-only control a phone cannot reach.
  expect(screen.getAllByRole('button', { name: 'Remove lockdown.png' })[0].className).not.toMatch(/opacity-0/);
});

it('a drill card never shows the live words', () => {
  render(<PanicContentEditor kind="lockdown" mode="drill" accent="red" label="Lockdown" />);
  expect(screen.getByTestId('alert-status-lockdown')).toHaveTextContent('Uses live content');
  expect(screen.queryByTestId('standard-wording-lockdown')).toBeNull();
});

it('adding your own picture or video is offered as optional', () => {
  render(<PanicContentEditor kind="weather" mode="live" accent="violet" label="Weather" />);
  expect(screen.getByText('Add your own picture or video (optional)')).toBeInTheDocument();
});
