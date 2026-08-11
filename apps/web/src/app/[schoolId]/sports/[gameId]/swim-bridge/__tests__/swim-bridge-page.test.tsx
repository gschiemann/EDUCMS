/**
 * Swim bridge page — render-branch smoke tests (Inputs-wave SWIM).
 *
 * CLAUDE.md cross-browser rule: Web Serial is Chromium-only, so this page
 * MUST render a clear graceful fallback pointing at the manual Lane Pad.
 * jsdom has no `navigator.serial`, which makes it a perfect stand-in for
 * Safari/Firefox — the first test IS the WebKit-degrade check. The second
 * stubs `navigator.serial` to prove the Chromium branch mounts the
 * Connect flow + the lane-pad collision warning.
 *
 * The serial/POST machinery itself is covered by the pure-glue suite in
 * src/lib/__tests__/swim-bridge.test.ts — this file only proves the two
 * render branches actually mount (CLAUDE.md rule #9).
 */
import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'school-1', gameId: 'game-1' }),
}));

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import SwimBridgePage from '../page';

describe('SwimBridgePage — browser-support branches', () => {
  afterEach(() => {
    // Remove any stubbed Web Serial surface between tests.
    delete (window.navigator as { serial?: unknown }).serial;
  });

  it('renders the graceful fallback when Web Serial is unavailable (the Safari/Firefox path)', async () => {
    render(<SwimBridgePage />);
    // Support detection runs in an effect — wait for the resolved branch.
    expect(
      await screen.findByText(/needs Chrome or Edge on a laptop at the timing table/i),
    ).toBeInTheDocument();
    // The documented alternative is the manual Lane Pad, linked back to
    // the game console.
    const padLink = screen.getByRole('link', { name: /open the lane pad instead/i });
    expect(padLink).toHaveAttribute('href', '/school-1/sports/game-1');
    // No Connect affordance on an unsupported browser.
    expect(screen.queryByRole('button', { name: /connect timing console/i })).toBeNull();
  });

  it('renders the Connect flow + lane-pad pause warning when Web Serial exists (Chromium path)', async () => {
    Object.defineProperty(window.navigator, 'serial', {
      value: { requestPort: jest.fn(), getPorts: jest.fn().mockResolvedValue([]) },
      configurable: true,
    });
    render(<SwimBridgePage />);
    expect(
      await screen.findByRole('button', { name: /connect timing console/i }),
    ).toBeInTheDocument();
    // The event-label collision trap: both the bridge and the manual pad
    // write the same results — the warning must be visible up front.
    expect(screen.getByText(/pause the manual lane pad while the bridge is live/i)).toBeInTheDocument();
    // Nothing fetched before the operator's Connect gesture — credentials
    // are minted inside the click handler only.
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
