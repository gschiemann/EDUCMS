/**
 * Muse beta DEV-026 (2026-10-07): a duration outside 1–600 s was clamped
 * silently in the playlist wizard. The clamp stays; now it is said.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { clampItemSeconds } from '@/lib/duration-clamp';

jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn(async () => ({})) }));

import { SelectedMediaDrawer } from '../PlaylistCreateWizard';

const ASSETS = [{ id: 'a1', originalName: 'poster.png', mimeType: 'image/png', fileUrl: 'https://cdn/x.png' }];

function mount(onDuration = jest.fn(), onSetAll = jest.fn()) {
  render(
    <SelectedMediaDrawer
      items={[{ assetId: 'a1', durationMs: 10_000 }]}
      allAssets={ASSETS}
      onReorder={jest.fn()}
      onRemove={jest.fn()}
      onDuration={onDuration}
      onSetAll={onSetAll}
    />,
  );
  return { onDuration, onSetAll };
}

it('clampItemSeconds reports which way it clamped', () => {
  expect(clampItemSeconds(900)).toEqual({ seconds: 600, clamped: 'high' });
  expect(clampItemSeconds(0)).toEqual({ seconds: 1, clamped: 'low' });
  expect(clampItemSeconds(30)).toEqual({ seconds: 30, clamped: null });
  expect(clampItemSeconds(NaN)).toEqual({ seconds: 10, clamped: null });
});

it('typing 900 on an item saves 600 AND says why', () => {
  const { onDuration } = mount();
  fireEvent.change(screen.getByLabelText(/Duration in seconds for poster.png/), { target: { value: '900' } });
  expect(onDuration).toHaveBeenCalledWith('a1', 600);
  expect(screen.getByTestId('duration-clamp-note')).toHaveTextContent('Durations run from 1 to 600 seconds — set to 600.');
});

it('an in-range value clears the note', () => {
  mount();
  const input = screen.getByLabelText(/Duration in seconds for poster.png/);
  fireEvent.change(input, { target: { value: '900' } });
  fireEvent.change(input, { target: { value: '45' } });
  expect(screen.queryByTestId('duration-clamp-note')).toBeNull();
});

it('the Set all field says so too', () => {
  mount();
  fireEvent.change(screen.getByLabelText('Set duration for every selected item'), { target: { value: '0' } });
  expect(screen.getByTestId('duration-clamp-note')).toHaveTextContent('set to 1.');
});
