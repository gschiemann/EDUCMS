/**
 * VenueOS Sports — CreateGameModal tests (Sports Wave S4-3, P2,
 * 2026-07-02 deep-pass audit finding: "New-game modal heavier than happy
 * path — 3 layout dropdowns duplicate the in-game Setup panel").
 *
 * Two things this test proves:
 *   1. The three surface-layout dropdowns are collapsed behind a single
 *      "Advanced: pick layouts now" disclosure by default (the happy path
 *      is sport + teams + go).
 *   2. The gallery "Use for a game →" deep link (Wave S2-3 —
 *      `initialPresetTemplate`) STILL preselects the right dropdown AND
 *      auto-expands the Advanced disclosure, so the operator can see what
 *      got applied instead of it landing behind a closed panel.
 */
import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'school-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@/components/assets/AssetPicker', () => ({
  AssetPicker: () => null,
}));

const TEMPLATES = [
  { id: 'tmpl-board-1', name: 'Stadium Scoreboard', isSystem: true, screenWidth: 1920, screenHeight: 1080, category: 'sports-scoreboard' },
  { id: 'tmpl-ribbon-1', name: 'LED Ribbon Classic', isSystem: true, screenWidth: 1920, screenHeight: 192, category: 'sports-ribbon' },
];

jest.mock('@/hooks/use-api', () => ({
  useCreateGame: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useTemplates: () => ({ data: TEMPLATES }),
  useScrapeBranding: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

import { CreateGameModal } from '../page';

describe('CreateGameModal — Advanced layouts disclosure', () => {
  it('collapses the layout dropdowns behind a closed Advanced <details> by default', () => {
    render(<CreateGameModal onClose={jest.fn()} />);
    const summary = screen.getByText('Advanced: pick layouts now');
    expect(summary).toBeInTheDocument();
    // The native <details> the summary belongs to is closed — jsdom (unlike
    // a real browser) still exposes closed-<details> content in the DOM
    // tree, so `open === false` is the actual collapse assertion; visually
    // + to assistive tech a closed <details> hides its content.
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
  });

  it('shows the "When is it?" optional date field on the happy path (not behind Advanced)', () => {
    render(<CreateGameModal onClose={jest.fn()} />);
    expect(screen.getByText(/When is it\?/)).toBeInTheDocument();
  });

  it('shows a sport search box (19 sports > 8 threshold)', () => {
    render(<CreateGameModal onClose={jest.fn()} />);
    expect(screen.getByPlaceholderText('Search sports…')).toBeInTheDocument();
  });
});

describe('CreateGameModal — gallery deep-link preselect (Wave S2-3, kept working)', () => {
  it('auto-expands Advanced and preselects the scoreboard template when arriving via deep link', () => {
    render(
      <CreateGameModal
        onClose={jest.fn()}
        initialPresetTemplate={{ id: 'tmpl-board-1', surface: 'scoreboard' }}
      />,
    );
    // Advanced is open — its content (the per-surface labels) is now visible.
    const details = screen.getByText('Advanced: pick layouts now').closest('details');
    expect((details as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByText('Scoreboard')).toBeInTheDocument();
    expect(screen.getByText('Ribbon')).toBeInTheDocument();
    expect(screen.getByText('Scorebug')).toBeInTheDocument();
    // The Scoreboard select has the deep-linked template selected.
    const scoreboardSelect = screen.getByText('Scoreboard').closest('div')?.querySelector('select');
    expect(scoreboardSelect).toHaveValue('tmpl-board-1');
  });

  it('preselects the ribbon dropdown when surface=ribbon', () => {
    render(
      <CreateGameModal
        onClose={jest.fn()}
        initialPresetTemplate={{ id: 'tmpl-ribbon-1', surface: 'ribbon' }}
      />,
    );
    const ribbonSelect = screen.getByText('Ribbon').closest('div')?.querySelector('select');
    expect(ribbonSelect).toHaveValue('tmpl-ribbon-1');
  });
});
