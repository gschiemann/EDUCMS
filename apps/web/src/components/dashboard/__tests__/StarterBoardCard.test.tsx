/**
 * StarterBoardCard — the "this is what your screens will show" simulated TV.
 *
 * These are RENDER tests, not a static trace: the real component mounts against
 * the real `useStarterBoard` resolver, so the gate logic and the resolver are
 * exercised together. What they lock down:
 *
 *   1. It RETIRES. One paired screen and the card is gone — permanently, with no
 *      dismiss state to get wrong.
 *   2. It never FLASHES. While `useScreens` is still in flight, "zero screens"
 *      is not yet a fact, so nothing renders (a tenant with a live wall of
 *      displays must never see a "you have no screens" card, even for a frame).
 *   3. It renders the REAL board — a live ScaledTemplateThumbnail at the
 *      template's own resolution — plus the two moves that follow it.
 *   4. A read-only viewer, who can neither edit a template nor pair a screen,
 *      gets nothing instead of two buttons that would 403.
 *   5. It costs NOTHING for tenants it doesn't apply to: the template fetch is
 *      never issued when the fleet is non-empty or no starter board exists.
 */
import { render, screen } from '@testing-library/react';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

// The real thumbnail lazy-loads the entire widget catalog through next/dynamic.
// Stand in for it — this suite is about the GATE + the wiring, and the live
// render itself is covered by the templates gallery suites.
jest.mock('@/components/templates/ScaledTemplateThumbnail', () => ({
  ScaledTemplateThumbnail: (props: any) => (
    <div
      data-testid="board-render"
      data-width={props.screenWidth}
      data-height={props.screenHeight}
      data-freeze={String(props.freeze)}
      data-zones={props.zones.length}
    />
  ),
}));

const useScreens = jest.fn();
const usePlaylists = jest.fn();
const useTemplate = jest.fn();
jest.mock('@/hooks/use-api', () => ({
  useScreens: (...a: any[]) => useScreens(...a),
  usePlaylists: (...a: any[]) => usePlaylists(...a),
  useTemplate: (...a: any[]) => useTemplate(...a),
}));

let role = 'DISTRICT_ADMIN';
jest.mock('@/store/ui-store', () => ({
  useUIStore: (selector: any) => selector({ user: { role } }),
}));

import { StarterBoardCard } from '../StarterBoardCard';

const TEMPLATE = {
  id: 'tpl-1',
  name: 'Welcome — Rosewood Elementary',
  screenWidth: 3840,
  screenHeight: 2160,
  bgColor: '#BFE8FF',
  bgGradient: null,
  bgImage: null,
  zones: [{ id: 'z1', widgetType: 'ANIMATED_WELCOME', x: 0, y: 0, width: 100, height: 100 }],
};

const STARTER_PLAYLIST = {
  id: 'pl-1',
  name: 'My first playlist',
  createdAt: '2026-08-24T00:00:00.000Z',
  template: { id: 'tpl-1', name: TEMPLATE.name, screenWidth: 3840, screenHeight: 2160 },
};

/** Wire the three data hooks for one scenario. */
function setup(opts: {
  screens?: any[];
  screensSettled?: boolean;
  playlists?: any[];
  template?: any;
}) {
  const { screens = [], screensSettled = true, playlists = [STARTER_PLAYLIST], template = TEMPLATE } = opts;
  useScreens.mockReturnValue({ data: screens, isSuccess: screensSettled });
  usePlaylists.mockReturnValue({ data: playlists });
  // Mirror useTemplate's real `enabled: !!id` behavior so the "never fetched"
  // assertions mean what they say.
  useTemplate.mockImplementation((id: string) => ({ data: id ? template : undefined }));
}

beforeEach(() => {
  jest.clearAllMocks();
  role = 'DISTRICT_ADMIN';
});

describe('<StarterBoardCard />', () => {
  it('shows the simulated screen when the fleet is empty and a starter board exists', () => {
    setup({});
    render(<StarterBoardCard schoolId="rosewood" />);

    expect(screen.getByText('This is what your screens will show')).toBeInTheDocument();
    expect(screen.getByText('Your first board is ready')).toBeInTheDocument();
    // The REAL board, at its own resolution, live (not the static poster).
    const board = screen.getByTestId('board-render');
    expect(board).toHaveAttribute('data-width', '3840');
    expect(board).toHaveAttribute('data-height', '2160');
    expect(board).toHaveAttribute('data-freeze', 'false');
    expect(board).toHaveAttribute('data-zones', '1');
  });

  it('offers both next moves — customize the board, or pair a screen', () => {
    setup({});
    render(<StarterBoardCard schoolId="rosewood" />);

    expect(screen.getByRole('link', { name: /customize this board/i })).toHaveAttribute(
      'href',
      '/rosewood/templates/builder/tpl-1',
    );
    expect(screen.getByRole('link', { name: /pair a screen/i })).toHaveAttribute(
      'href',
      '/rosewood/screens',
    );
  });

  it('names the board + playlist so the operator can find them again', () => {
    setup({});
    render(<StarterBoardCard schoolId="rosewood" />);
    expect(screen.getByText('Welcome — Rosewood Elementary')).toBeInTheDocument();
    expect(screen.getByText('My first playlist')).toBeInTheDocument();
  });

  it('RETIRES the moment a real screen is paired — and never fetches the template', () => {
    setup({ screens: [{ id: 'scr-1', status: 'ONLINE' }] });
    const { container } = render(<StarterBoardCard schoolId="rosewood" />);

    expect(container).toBeEmptyDOMElement();
    expect(useTemplate).toHaveBeenCalledWith('');
  });

  it('renders nothing while the screens query is still in flight (no flash)', () => {
    setup({ screens: undefined, screensSettled: false });
    const { container } = render(<StarterBoardCard schoolId="rosewood" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a tenant with no starter board (pre-seed tenants)', () => {
    setup({ playlists: [{ id: 'pl-9', name: 'Assets only', createdAt: '2026-01-01', template: null }] });
    const { container } = render(<StarterBoardCard schoolId="rosewood" />);
    expect(container).toBeEmptyDOMElement();
    expect(useTemplate).toHaveBeenCalledWith('');
  });

  it('renders nothing for a read-only viewer', () => {
    role = 'RESTRICTED_VIEWER';
    setup({});
    const { container } = render(<StarterBoardCard schoolId="rosewood" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('falls back to the oldest template-backed playlist when the seeded one was renamed', () => {
    setup({
      playlists: [
        { id: 'pl-b', name: 'Lunch loop', createdAt: '2026-09-01T00:00:00Z', template: { id: 'tpl-2', name: 'Lunch' } },
        { id: 'pl-a', name: 'Our lobby board', createdAt: '2026-08-24T00:00:00Z', template: { id: 'tpl-1', name: TEMPLATE.name } },
      ],
    });
    render(<StarterBoardCard schoolId="rosewood" />);
    expect(useTemplate).toHaveBeenCalledWith('tpl-1');
    expect(screen.getByText('Our lobby board')).toBeInTheDocument();
  });
});
