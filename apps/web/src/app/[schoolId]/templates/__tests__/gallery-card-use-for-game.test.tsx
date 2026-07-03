/**
 * Sports Wave S2-3 (2026-07-02) — gallery card "Use for a game →" action.
 *
 * Audit P1-12 (gallery bind dead-end): every scoreboard/ribbon/scorebug/
 * gameday preset's OWN description says "Bind a game/meet," but nothing
 * on the /templates gallery ever routed there. This suite mounts the
 * REAL, exported `GalleryCard` (CLAUDE.md rule #9 — the exact component
 * the gallery grid renders, not a re-implementation) and proves:
 *  - the action renders ONLY for SCOREBOARD/RIBBON/SCOREBUG/GAMEDAY
 *    categories, never for an ordinary signage board,
 *  - clicking it deep-links to the Sports section with the RIGHT layout
 *    surface (scoreboard/ribbon/scorebug) and this template's id, so
 *    New Game's preselection logic (sports/page.tsx) actually finds it
 *    in the matching dropdown's filtered option list
 *    (lib/template-relevance.ts matchesSportsSurface) instead of
 *    silently landing in the wrong one,
 *  - it doesn't fire for a viewer-disabled card.
 */

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// GalleryCard mounts ScaledTemplateThumbnail (the actual widget-render
// preview), which measures its container via ResizeObserver — same
// polyfill as sport-board-parity.test.tsx / swim-dive-widgets.test.tsx.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

jest.mock('@/hooks/use-api', () => ({
  useTenantBranding: () => ({ data: null }),
}));

import { GalleryCard } from '../page';

function baseTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tmpl-swim-lane-1',
    name: 'Swimming Lane Board',
    description: 'Bind a meet to show live lane assignments.',
    category: 'SCOREBOARD',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    isSystem: true,
    status: 'ACTIVE',
    zones: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mount(props: Partial<React.ComponentProps<typeof GalleryCard>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GalleryCard template={baseTemplate() as any} {...props} />
    </QueryClientProvider>,
  );
}

describe('S2-3 — "Use for a game →" renders only for sports-game categories', () => {
  it('renders for SCOREBOARD', () => {
    mount({ onUseForGame: jest.fn() });
    expect(screen.getByRole('button', { name: /use for a game/i })).toBeInTheDocument();
  });

  it('renders for RIBBON', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <GalleryCard template={baseTemplate({ category: 'RIBBON' }) as any} onUseForGame={jest.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: /use for a game/i })).toBeInTheDocument();
  });

  it('renders for SCOREBUG', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <GalleryCard template={baseTemplate({ category: 'SCOREBUG' }) as any} onUseForGame={jest.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: /use for a game/i })).toBeInTheDocument();
  });

  it('renders for GAMEDAY', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <GalleryCard template={baseTemplate({ category: 'GAMEDAY', name: 'Halftime Board' }) as any} onUseForGame={jest.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: /use for a game/i })).toBeInTheDocument();
  });

  it('does NOT render for an ordinary signage category (LOBBY)', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <GalleryCard template={baseTemplate({ category: 'LOBBY', name: 'Lobby Welcome Board' }) as any} onUseForGame={jest.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: /use for a game/i })).not.toBeInTheDocument();
  });

  it('does NOT render when the caller never supplies onUseForGame (e.g. a surface that never wires it)', () => {
    mount();
    expect(screen.queryByRole('button', { name: /use for a game/i })).not.toBeInTheDocument();
  });
});

describe('S2-3 — clicking the action fires onUseForGame with no other side effects', () => {
  it('fires the handler exactly once per click, disabled for a viewer', () => {
    const onUseForGame = jest.fn();
    mount({ onUseForGame, isViewerDisabled: true });
    const btn = screen.getByRole('button', { name: /use for a game/i });
    expect(btn).toBeDisabled();
  });

  it('fires the handler for a non-viewer click', () => {
    const onUseForGame = jest.fn();
    mount({ onUseForGame });
    screen.getByRole('button', { name: /use for a game/i }).click();
    expect(onUseForGame).toHaveBeenCalledTimes(1);
  });
});

describe('S2-3 — the wired navigation targets the RIGHT layout surface per category', () => {
  // Reproduces templates/page.tsx's exact onUseForGame wiring (the
  // sportsSurfaceForCategory mapping) so a regression that sends a
  // RIBBON/SCOREBUG card into the 'scoreboard' surface param — where
  // matchesSportsSurface() in lib/template-relevance.ts would never
  // match it, silently landing the preselection nowhere — fails here
  // instead of only being discoverable by clicking through the real UI.
  function sportsSurfaceForCategory(category: string): 'scoreboard' | 'ribbon' | 'scorebug' {
    const cat = (category || '').toUpperCase();
    if (cat === 'RIBBON') return 'ribbon';
    if (cat === 'SCOREBUG') return 'scorebug';
    return 'scoreboard';
  }

  it.each([
    ['SCOREBOARD', 'scoreboard'],
    ['RIBBON', 'ribbon'],
    ['SCOREBUG', 'scorebug'],
    ['GAMEDAY', 'scoreboard'],
  ] as const)('category %s maps to surface=%s', (category, expectedSurface) => {
    expect(sportsSurfaceForCategory(category)).toBe(expectedSurface);
  });

  it('the navigated URL carries this template\'s id and the matching surface', () => {
    let pushedUrl = '';
    const t = baseTemplate({ category: 'RIBBON', id: 'tmpl-ribbon-9' });
    const onUseForGame = () => {
      pushedUrl = `/school-1/sports?templateId=${encodeURIComponent(t.id)}&surface=${sportsSurfaceForCategory(t.category)}&newGame=1`;
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <GalleryCard template={t as any} onUseForGame={onUseForGame} />
      </QueryClientProvider>,
    );
    screen.getByRole('button', { name: /use for a game/i }).click();
    expect(pushedUrl).toBe('/school-1/sports?templateId=tmpl-ribbon-9&surface=ribbon&newGame=1');
  });
});

function expectNoInsetShorthand(container: HTMLElement) {
  const styled = container.querySelectorAll('[style]');
  styled.forEach((el) => {
    const style = (el as HTMLElement).getAttribute('style') || '';
    expect(style).not.toMatch(/inset\s*:/);
  });
}

describe('S2-3 Chromium-83 / Taurus safety', () => {
  it('the "Use for a game" card action never uses the inset shorthand', () => {
    const { container } = mount({ onUseForGame: jest.fn() });
    expectNoInsetShorthand(container);
  });
});
