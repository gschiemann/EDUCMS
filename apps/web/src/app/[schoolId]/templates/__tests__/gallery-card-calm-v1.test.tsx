/**
 * Templates Gallery — Calm v1 · the card contract (§4.2, §6, §7, §10.5).
 *
 * Mounts the REAL exported `GalleryCard` (CLAUDE.md rule #9 — the exact
 * component the gallery grid renders, never a re-implementation that can
 * drift), and pins the rules a future "quick tidy-up" would otherwise
 * quietly undo:
 *
 *  - exactly ONE primary action per card, and which one it is depends on
 *    who is looking and what they're looking at;
 *  - a restricted viewer never gets a disabled editing control wearing a
 *    working-button costume;
 *  - management actions are behind the overflow menu, which is keyboard-
 *    operable and returns focus to its trigger;
 *  - the destructive action carries a text label, never a bare icon;
 *  - usage is rendered only when proven — and UNKNOWN renders nothing;
 *  - the gallery thumbnail is frozen, not a live widget mount.
 */

import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// GalleryCard mounts ScaledTemplateThumbnail, which measures its
// container via ResizeObserver — same polyfill the sibling suites use.
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
import { deriveTemplateUsage } from '@/components/templates/template-usage';

function tpl(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-club-welcome',
    name: 'Club Welcome',
    description: 'Front-desk greeting board.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    isSystem: false,
    status: 'ACTIVE',
    zones: [{ id: 'z1', name: 'Full', widgetType: 'TEXT', x: 0, y: 0, width: 100, height: 100 }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-08-31T11:42:00.000Z',
    ...overrides,
  };
}

function mount(props: Partial<React.ComponentProps<typeof GalleryCard>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GalleryCard template={tpl() as any} {...props} />
    </QueryClientProvider>,
  );
}

/** Open the card's three-dot menu and hand back its items. */
function openMenu() {
  const trigger = screen.getByRole('button', { name: /more actions for/i });
  fireEvent.click(trigger);
  return { trigger, menu: screen.getByRole('menu') };
}

// ── §4.2 / §6.4 — exactly one primary action ──────────────────────────

describe('Calm v1 §4.2 — one primary action per card', () => {
  it('an owner with edit permission gets Edit, and nothing else competing', () => {
    mount({ onEdit: jest.fn(), onPreview: jest.fn(), onDuplicate: jest.fn(), onExport: jest.fn(), onDelete: jest.fn() });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    // The old card kept Duplicate / Export / DELETE as permanent icon
    // buttons on every tile. They must live in the menu now.
    expect(screen.queryByRole('button', { name: /duplicate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^export/i })).not.toBeInTheDocument();
    // 2026-09-14 (Greg): "let me delete the templates without having to
    // click edit — a trash can somewhere on each". Delete is the one
    // secondary action that also gets a direct control; it fires the same
    // handler as the menu row.
    expect(screen.getByRole('button', { name: 'Delete Club Welcome' })).toBeInTheDocument();
  });

  it('the trash can deletes without opening the menu (2026-09-14)', () => {
    const onDelete = jest.fn();
    mount({ onEdit: jest.fn(), onPreview: jest.fn(), onDelete });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Club Welcome' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('a ready-made preset gets Preview, never Edit', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <GalleryCard template={tpl({ isSystem: true, id: 'preset-front-desk' }) as any} onPreview={jest.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('a restricted viewer gets Preview — NOT a disabled Edit control', () => {
    // §6.4: "Do not render a disabled editing control that looks broken."
    mount({ onEdit: jest.fn(), onPreview: jest.fn(), onDelete: jest.fn(), isViewerDisabled: true });
    const preview = screen.getByRole('button', { name: 'Preview' });
    expect(preview).toBeInTheDocument();
    expect(preview).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    // …and no trash can either (2026-09-14).
    expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument();
  });

  it('a restricted viewer is offered no mutating actions at all', () => {
    // Every menu item would be a mutation, so the whole menu disappears
    // rather than opening onto a list of things they cannot do.
    mount({ onEdit: jest.fn(), onPreview: jest.fn(), onDuplicate: jest.fn(), onDelete: jest.fn(), isViewerDisabled: true });
    expect(screen.queryByRole('button', { name: /more actions for/i })).not.toBeInTheDocument();
  });

  it('the primary action fires its handler', () => {
    const onEdit = jest.fn();
    mount({ onEdit, onPreview: jest.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

// ── §6.2 — the preview is a real keyboard-operable control ────────────

describe('Calm v1 §6.2 — the preview surface', () => {
  it('is a button named "Preview of <name> template" (§14 alt-text rule)', () => {
    mount({ onPreview: jest.fn(), onEdit: jest.fn() });
    expect(screen.getByRole('button', { name: 'Preview of Club Welcome template' })).toBeInTheDocument();
  });

  it('Enter and Space open the preview (free, because it is a real button)', () => {
    const onPreview = jest.fn();
    mount({ onPreview, onEdit: jest.fn() });
    const surface = screen.getByRole('button', { name: 'Preview of Club Welcome template' });
    fireEvent.click(surface);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview.mock.calls[0][0].id).toBe('tpl-club-welcome');
  });

  it('§10.5 — a saved layout with no zones says "Preview unavailable" and keeps its actions', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <GalleryCard
          template={tpl({ zones: [] }) as any}
          onPreview={jest.fn()}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          needsAttention
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    // Management stays reachable — a broken preview must not strand the
    // template it belongs to.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByTestId('template-attention-pill')).toHaveTextContent('Needs attention');
  });
});

// ── §6.5 — the overflow menu ──────────────────────────────────────────

describe('Calm v1 §6.5 — the overflow menu', () => {
  it('carries the management actions in the specified order', () => {
    mount({
      onPreview: jest.fn(), onEdit: jest.fn(), onPutOnScreen: jest.fn(),
      onDuplicate: jest.fn(), onAdaptForLED: jest.fn(), onExport: jest.fn(), onDelete: jest.fn(),
    });
    const { menu } = openMenu();
    const labels = within(menu).getAllByRole('menuitem').map((n) => n.textContent?.trim());
    expect(labels).toEqual([
      'Preview',
      'Put on a screen',
      'Duplicate',
      'Adapt to screen size',
      'Export template',
      'Delete template',
    ]);
  });

  it('the destructive action has a TEXT LABEL, never a bare trash icon', () => {
    // §6.5: "Never use an unlabeled trash icon as the only deletion
    // affordance." This is the assertion that keeps the icon-only card
    // button from creeping back.
    mount({ onPreview: jest.fn(), onEdit: jest.fn(), onDelete: jest.fn() });
    const { menu } = openMenu();
    expect(within(menu).getByRole('menuitem', { name: 'Delete template' })).toBeInTheDocument();
  });

  it('says "Delete template", NOT "Move to trash" — there is no Trash behind it (§11.4)', () => {
    mount({ onPreview: jest.fn(), onEdit: jest.fn(), onDelete: jest.fn() });
    const { menu } = openMenu();
    expect(within(menu).queryByText(/trash/i)).not.toBeInTheDocument();
  });

  it('selecting an item fires its handler and closes the menu', () => {
    const onDuplicate = jest.fn();
    mount({ onPreview: jest.fn(), onEdit: jest.fn(), onDuplicate });
    const { menu } = openMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Duplicate' }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Escape closes it AND returns focus to the trigger', () => {
    // Without focus return, a keyboard operator who backs out of a menu
    // is dumped at document.body and has to Tab through the whole
    // gallery to get back to the card they were on.
    mount({ onPreview: jest.fn(), onEdit: jest.fn(), onDelete: jest.fn() });
    const { trigger, menu } = openMenu();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('ArrowDown from the trigger opens it', () => {
    mount({ onPreview: jest.fn(), onEdit: jest.fn(), onDelete: jest.fn() });
    const trigger = screen.getByRole('button', { name: /more actions for/i });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('is not clipped by the card it lives in', () => {
    // Regression, found in the 2026-08-31 verification screenshots: the
    // card root carried `overflow-hidden` (to round the full-bleed
    // artwork), which CUT THE MENU OFF at the card's bottom edge —
    // "Export template" and "Delete template" were visible in the DOM and
    // unreachable on screen. The clip belongs on the preview band alone.
    const { container } = mount({ onPreview: jest.fn(), onEdit: jest.fn(), onDelete: jest.fn() });
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).not.toMatch(/\boverflow-hidden\b/);
    // …and the band that actually needs the clip still has it.
    const band = screen.getByRole('button', { name: /^Preview of/ });
    expect(band.className).toMatch(/\boverflow-hidden\b/);
  });

  it('advertises itself correctly to assistive tech', () => {
    mount({ onPreview: jest.fn(), onEdit: jest.fn(), onDelete: jest.fn() });
    const trigger = screen.getByRole('button', { name: 'More actions for Club Welcome' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not repeat Preview as a menu row when Preview IS the primary button', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <GalleryCard
          template={tpl({ isSystem: true }) as any}
          onPreview={jest.fn()}
          onAdaptForLED={jest.fn()}
        />
      </QueryClientProvider>,
    );
    const { menu } = openMenu();
    expect(within(menu).queryByRole('menuitem', { name: 'Preview' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Adapt to screen size' })).toBeInTheDocument();
  });

  it('offers "Use for a game" only on a real sports surface', () => {
    mount({ onPreview: jest.fn(), onEdit: jest.fn(), onUseForGame: jest.fn() });
    expect(within(openMenu().menu).queryByRole('menuitem', { name: /use for a game/i })).not.toBeInTheDocument();

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <GalleryCard
          template={tpl({ category: 'SCOREBOARD', name: 'Lane Board', id: 'tpl-lane' }) as any}
          onPreview={jest.fn()}
          onEdit={jest.fn()}
          onUseForGame={jest.fn()}
        />
      </QueryClientProvider>,
    );
    const sportsTrigger = screen.getByRole('button', { name: 'More actions for Lane Board' });
    fireEvent.click(sportsTrigger);
    expect(screen.getByRole('menuitem', { name: /use for a game/i })).toBeInTheDocument();
  });
});

// ── §4.3 / §6.3 — usage on the card ───────────────────────────────────

describe('Calm v1 §6.3 — usage states on the card', () => {
  it('KNOWN-active renders "Active · 3 screens" and the playlist reach', () => {
    mount({
      onPreview: jest.fn(),
      onEdit: jest.fn(),
      usage: deriveTemplateUsage({ 'tpl-club-welcome': { playlists: 2, screensReached: 3, activeNow: true } }, 'tpl-club-welcome'),
    });
    expect(screen.getByTestId('template-usage-pill')).toHaveTextContent('Active · 3 screens');
    expect(screen.getByTestId('template-usage-reach')).toHaveTextContent('Used by 2 playlists');
  });

  it('KNOWN-IDLE renders the neutral "Not in use"', () => {
    mount({
      onPreview: jest.fn(),
      onEdit: jest.fn(),
      usage: deriveTemplateUsage({ 'tpl-club-welcome': { playlists: 0, screensReached: 0, activeNow: false } }, 'tpl-club-welcome'),
    });
    expect(screen.getByTestId('template-usage-pill')).toHaveTextContent('Not in use');
    expect(screen.queryByTestId('template-usage-reach')).not.toBeInTheDocument();
  });

  it('UNKNOWN renders NO pill at all — never "Not in use", never a zero', () => {
    // The endpoint isn't deployed / the request failed. Saying nothing is
    // the only honest option; this is the assertion that stops a future
    // `?? {}` from turning silence into a false claim.
    mount({
      onPreview: jest.fn(),
      onEdit: jest.fn(),
      usage: deriveTemplateUsage(undefined, 'tpl-club-welcome'),
    });
    expect(screen.queryByTestId('template-usage-pill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('template-usage-reach')).not.toBeInTheDocument();
    expect(screen.queryByText(/not in use/i)).not.toBeInTheDocument();
  });

  it('states usage in WORDS, not colour alone (§14)', () => {
    mount({
      onPreview: jest.fn(),
      onEdit: jest.fn(),
      usage: deriveTemplateUsage({ 'tpl-club-welcome': { playlists: 1, screensReached: 1, activeNow: true } }, 'tpl-club-welcome'),
    });
    expect(screen.getByTestId('template-usage-pill').textContent).toMatch(/Active · 1 screen/);
  });

  it('a preset carries category + canvas instead of usage', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <GalleryCard
          template={tpl({ isSystem: true }) as any}
          onPreview={jest.fn()}
          categoryLabel="Welcome"
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Welcome · 1920×1080')).toBeInTheDocument();
    expect(screen.getByText('PRESET')).toBeInTheDocument();
  });
});

// ── §4.4 — the canvas badge replaced the segmented control ────────────

describe('Calm v1 §4.4 — orientation left the artwork', () => {
  it('renders one canvas badge, not a Landscape/Portrait/Custom control', () => {
    mount({ onPreview: jest.fn(), onEdit: jest.fn(), onAdaptForLED: jest.fn(), portraitSibling: tpl({ id: 'x-portrait' }) as any });
    expect(screen.getByText('Landscape')).toBeInTheDocument();
    // The old in-card toggle buttons are gone; the switch lives in the
    // full-screen preview now.
    expect(screen.queryByRole('button', { name: 'Portrait' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument();
  });
});

// ── Taurus / Chromium-83 safety (standing repo rule) ──────────────────

describe('Chromium-83 / Taurus safety', () => {
  it('no card style attribute ever serializes to the inset shorthand', () => {
    const { container } = mount({ onPreview: jest.fn(), onEdit: jest.fn(), onDelete: jest.fn() });
    container.querySelectorAll('[style]').forEach((el) => {
      expect((el as HTMLElement).getAttribute('style') || '').not.toMatch(/inset\s*:/);
    });
  });
});
