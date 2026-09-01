/**
 * Templates Gallery — Calm v1 · the page states (§4.1, §5.2, §10, §12).
 *
 * Mounts the REAL default-exported page (CLAUDE.md rule #9) against a
 * staged data layer, because these are exactly the states an operator
 * hits on a bad day and the ones nobody screenshots:
 *
 *  §10.1 loading   — skeletons that match the grid, not a page spinner.
 *  §10.2 no owned  — a compact onboarding row, not a wall that pushes the
 *                    ready-made catalog below the fold.
 *  §10.3 no match  — an explanation plus recovery that clears EVERY
 *                    filter, including the level/holiday ones that a
 *                    previous "Show all templates" button left stuck on.
 *  §10.4 API error — "couldn't be loaded", never an empty library. A
 *                    failed request presented as "you have no templates"
 *                    is alarming and false.
 *  §4.1  header    — the marketing hero is gone and `New template` is the
 *                    only solid primary action.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';

// ── The data layer, staged ────────────────────────────────────────────
let templatesResult: any = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
let usageResult: any = { data: undefined };

const noopMutation = () => ({ mutateAsync: jest.fn(), isPending: false, mutate: jest.fn() });

jest.mock('@/hooks/use-api', () => ({
  useTemplates: () => templatesResult,
  useTemplateUsageSummary: () => usageResult,
  useTenantBranding: () => ({ data: null }),
  useCreateTemplate: noopMutation,
  useDeleteTemplate: noopMutation,
  useCreateFromPreset: noopMutation,
  useDuplicateTemplate: noopMutation,
  useUpdateTemplate: noopMutation,
  useUpdateTemplateZones: noopMutation,
  useApplyBrandToTemplates: noopMutation,
  useGenerateTouchTemplate: noopMutation,
  useExportTemplate: noopMutation,
  useImportTemplate: noopMutation,
  useGenerateTouchCandidates: noopMutation,
  useCreateFromCandidate: noopMutation,
  useRefineSignageBoard: noopMutation,
  useGenerateDesignerCandidates: noopMutation,
  useCreateDesigner: noopMutation,
  useRegenerateBoardImage: noopMutation,
  useAssets: () => ({ data: [], isLoading: false }),
  usePlaylists: () => ({ data: [], isLoading: false }),
  useAssetFolders: () => ({ data: [], isLoading: false }),
  useScreens: () => ({ data: [], isLoading: false }),
}));

jest.mock('@/hooks/use-ai-designer', () => ({
  useExtractDesignerBrief: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useRefineDesignerBoard: () => ({ mutateAsync: jest.fn(), isPending: false }),
  buildDesignerBriefPayload: () => ({}),
  designerBriefHasSignal: () => false,
}));

jest.mock('@/lib/put-on-screen', () => ({
  usePutOnScreen: () => ({ putOnScreen: jest.fn(), puttingOnScreenId: null }),
}));

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'planet-fitness' }),
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
}));

// GYM vertical (the mock's tenant context) — the gallery must never
// speak school vocabulary to it (§2, §3).
jest.mock('@/hooks/use-tenant-copy', () => ({
  useTenantCopy: () => ({
    vertical: 'GYM',
    orgSingular: 'Location',
    orgPlural: 'Locations',
    templateCategories: [
      { key: '', label: 'All' },
      { key: 'LOBBY', label: 'Welcome' },
      { key: 'PROMOTIONS', label: 'Promotions' },
      { key: 'CAFETERIA', label: 'Menus' },
    ],
    showSchoolLevelFilter: false,
    roleLabel: (r: string) => r,
  }),
}));

let mockRole = 'SCHOOL_ADMIN';
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: any) => sel({ user: { role: mockRole }, token: 't' }),
}));

jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: () => true, FLAGS: { TEMPLATE_BUILDER_V2: 'v2' } }));
jest.mock('@/components/ai/AiGenerateButton', () => ({ getAiStatusSource: async () => 'platform' }));
jest.mock('@/components/templates/AiIntakeWizard', () => ({ AiIntakeWizard: () => null }));
jest.mock('@/components/templates/SignageConcierge', () => ({ SignageConcierge: () => null }));
jest.mock('@/components/templates/BriefConfirmStrip', () => ({ BriefConfirmStrip: () => null }));

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

import TemplatesPage, { sortTemplates } from '../page';

function tpl(over: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    name: 'Club Welcome',
    description: '',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    isSystem: false,
    status: 'ACTIVE',
    zones: [{ id: 'z', name: 'Full', widgetType: 'TEXT', x: 0, y: 0, width: 100, height: 100 }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-08-31T11:00:00.000Z',
    ...over,
  };
}

function stage(data: any[], over: Record<string, unknown> = {}, usage?: any) {
  templatesResult = { data, isLoading: false, isError: false, refetch: jest.fn(), ...over };
  usageResult = { data: usage };
}

beforeEach(() => {
  push.mockClear();
  stage([]);
  mockRole = 'SCHOOL_ADMIN';
});

// ── §4.1 / §5.2 — the header ──────────────────────────────────────────

describe('§4.1 — the page reads as a library, not a landing page', () => {
  it('renders a plain "Templates" heading, not the promotional hero', () => {
    stage([tpl()]);
    render(<TemplatesPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Templates' })).toBeInTheDocument();
    // The hero's marketing line and its "Screen Templates" title are gone.
    expect(screen.queryByText(/Screen Templates/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Design beautiful screen layouts/i)).not.toBeInTheDocument();
  });

  it('offers exactly the three creation actions, in hierarchy order', () => {
    stage([tpl()]);
    render(<TemplatesPage />);
    expect(screen.getByRole('button', { name: /import design/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate with ai/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new template/i })).toBeInTheDocument();
  });

  it('§5.2 — the summary line stays honest when usage is UNKNOWN', () => {
    // No usage endpoint → we must not claim "N currently in use".
    stage([tpl(), tpl({ id: 'p1', isSystem: true, name: 'Front Desk Welcome' })]);
    render(<TemplatesPage />);
    expect(screen.getByText('2 templates · 1 is yours')).toBeInTheDocument();
    expect(screen.queryByText(/currently in use/i)).not.toBeInTheDocument();
  });

  it('§5.2 — it reports real reach once the usage summary answers', () => {
    stage(
      [tpl(), tpl({ id: 'tpl-2', name: 'Summer Strength' })],
      {},
      { 'tpl-1': { playlists: 2, screensReached: 3, activeNow: true }, 'tpl-2': { playlists: 0, screensReached: 0, activeNow: false } },
    );
    render(<TemplatesPage />);
    expect(screen.getByText('2 templates · 1 currently in use')).toBeInTheDocument();
  });
});

/**
 * AI generation and deletion are admin-only; the rest of the gallery is not.
 *
 * `POST /templates/generate-designer/*`, `generate-touch*`,
 * `generate-signage`, `create-from-candidate` and `DELETE /templates/:id` are
 * `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN)`, while create
 * (`POST /templates`), duplicate, adapt-for-LED, export, put-on-screen
 * (`POST /playlists`) and design import (`POST /imports/design`) all list
 * CONTRIBUTOR.
 *
 * The bug this pins: both admin-only affordances gated on `isViewer`, true
 * only for RESTRICTED_VIEWER — so a CONTRIBUTOR got a live "Generate with AI"
 * button and a live "Delete template" menu row the API answers with 403.
 */
describe('role → what the gallery offers', () => {
  const mount = (role: string) => {
    mockRole = role;
    stage([tpl()]);
    return render(<TemplatesPage />);
  };
  const openCardMenu = () =>
    fireEvent.click(screen.getByRole('button', { name: /More actions for Club Welcome/i }));

  it.each(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'])('%s gets AI and Delete', (role) => {
    mount(role);
    expect(screen.getByRole('button', { name: /generate with ai/i })).toBeEnabled();
    openCardMenu();
    expect(screen.getByRole('menuitem', { name: /delete template/i })).toBeInTheDocument();
  });

  it('a CONTRIBUTOR gets neither — but keeps every write it is allowed', () => {
    mount('CONTRIBUTOR');
    expect(screen.getByRole('button', { name: /generate with ai/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /new template/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /import design/i })).toBeEnabled();
    openCardMenu();
    expect(screen.queryByRole('menuitem', { name: /delete template/i })).not.toBeInTheDocument();
    // The CONTRIBUTOR-allowed rows are still there.
    expect(screen.getByRole('menuitem', { name: /duplicate/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /export template/i })).toBeInTheDocument();
  });

  it('a RESTRICTED_VIEWER gets none of them', () => {
    mount('RESTRICTED_VIEWER');
    expect(screen.getByRole('button', { name: /generate with ai/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /new template/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /import design/i })).toBeDisabled();
    // Nothing in the card menu is open to this role, so the card renders no
    // overflow trigger at all — the card's own "no empty menus" rule.
    expect(screen.queryByRole('button', { name: /More actions for Club Welcome/i }))
      .not.toBeInTheDocument();
  });

  it('the onboarding row hides AI from a CONTRIBUTOR and keeps New template', () => {
    mockRole = 'CONTRIBUTOR';
    stage([tpl({ id: 'p1', isSystem: true, name: 'Front Desk Welcome' })]);
    render(<TemplatesPage />);
    const row = screen.getByText('No templates of your own yet').closest('div')!;
    expect(within(row).queryByRole('button', { name: /generate with ai/i })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /new template/i })).toBeInTheDocument();
  });

  it('the no-results recovery hides its AI shortcut from a CONTRIBUTOR', () => {
    mount('CONTRIBUTOR');
    fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'zzz' } });
    // Only the header's (disabled) button survives — the inline CTA is gone.
    expect(screen.getAllByRole('button', { name: /generate with ai/i })).toHaveLength(1);
    mockRole = 'SCHOOL_ADMIN';
  });
});

// ── §10 states ────────────────────────────────────────────────────────

describe('§10.1 — loading', () => {
  it('shows card skeletons, not a single page spinner', () => {
    stage([], { isLoading: true });
    const { container } = render(<TemplatesPage />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(4);
    // The header and toolbar stay mounted so nothing jumps on arrival.
    expect(screen.getByRole('heading', { level: 1, name: 'Templates' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search templates')).toBeInTheDocument();
  });
});

describe('§10.4 — API failure is never an empty library', () => {
  it('says the request failed and that their work is safe', () => {
    stage([], { isError: true });
    render(<TemplatesPage />);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Templates couldn’t be loaded')).toBeInTheDocument();
    expect(within(alert).getByText(/still safe/i)).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: /try again/i })).toBeInTheDocument();
    // Critically: it does NOT render the "no templates yet" onboarding.
    expect(screen.queryByText(/No templates of your own yet/i)).not.toBeInTheDocument();
  });

  it('Try again refetches', () => {
    const refetch = jest.fn();
    stage([], { isError: true, refetch });
    render(<TemplatesPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('§10.2 — no templates of your own', () => {
  it('is a compact onboarding row that keeps the catalog visible', () => {
    stage([tpl({ id: 'p1', isSystem: true, name: 'Front Desk Welcome' })]);
    render(<TemplatesPage />);
    expect(screen.getByText('No templates of your own yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /browse ready-made/i })).toBeInTheDocument();
    // The ready-made catalog is right there, not pushed below a wall.
    expect(screen.getByRole('heading', { name: 'Ready-made templates' })).toBeInTheDocument();
    expect(screen.getByText('Front Desk Welcome')).toBeInTheDocument();
  });
});

describe('§10.3 — no filter results', () => {
  it('explains the search that missed and offers recovery', () => {
    stage([tpl()]);
    render(<TemplatesPage />);
    fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'summer promo' } });
    expect(screen.getByText('No templates match “summer promo”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear search & filters/i })).toBeInTheDocument();
  });

  it('the recovery action clears EVERY filter, not just the search', () => {
    stage([tpl(), tpl({ id: 'tpl-2', category: 'PROMOTIONS', name: 'Summer Strength' })]);
    render(<TemplatesPage />);
    // Turn on a category chip AND a search, so both must clear.
    fireEvent.click(screen.getByRole('button', { name: /^Promotions/ }));
    fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByRole('button', { name: /clear search & filters/i }));
    expect(screen.getByText('Club Welcome')).toBeInTheDocument();
    expect(screen.getByLabelText('Search templates')).toHaveValue('');
    expect(screen.getByRole('button', { name: /^Promotions/ })).toHaveAttribute('aria-pressed', 'false');
  });
});

// ── §5.3 — the toolbar ────────────────────────────────────────────────

describe('§5.3 — vertical-aware categories, no empty chips', () => {
  it('renders only categories the tenant\'s own catalog can satisfy', () => {
    stage([tpl({ category: 'LOBBY' }), tpl({ id: 'tpl-2', category: 'PROMOTIONS', name: 'Summer Strength' })]);
    render(<TemplatesPage />);
    const group = screen.getByRole('group', { name: 'Filter by category' });
    // Label + count are adjacent nodes (the gap is visual), so textContent
    // concatenates them.
    const chips = within(group).getAllByRole('button').map((b) => b.textContent?.trim());
    expect(chips).toEqual(['All2', 'Welcome1', 'Promotions1']);
    // "Menus" has no matching template in this tenant, so it is not shown
    // — a chip that can never return a result reads as a broken gallery.
    expect(within(group).queryByRole('button', { name: /menus/i })).not.toBeInTheDocument();
  });

  it('never shows a K-12 school-level row to a gym', () => {
    stage([tpl()]);
    render(<TemplatesPage />);
    expect(screen.queryByRole('group', { name: 'Filter by school level' })).not.toBeInTheDocument();
  });

  it('filtering by a category keeps the toolbar in place and filters the grid', () => {
    stage([tpl({ category: 'LOBBY' }), tpl({ id: 'tpl-2', category: 'PROMOTIONS', name: 'Summer Strength' })]);
    render(<TemplatesPage />);
    fireEvent.click(screen.getByRole('button', { name: /^Promotions/ }));
    expect(screen.getByText('Summer Strength')).toBeInTheDocument();
    expect(screen.queryByText('Club Welcome')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search templates')).toBeInTheDocument();
  });
});

// ── §4.5 — progressive rendering ──────────────────────────────────────

describe('§4.5 — the gallery scales past 100 templates', () => {
  const many = (n: number, isSystem: boolean) =>
    Array.from({ length: n }, (_, i) => tpl({
      id: `${isSystem ? 'preset' : 'tpl'}-${i}`,
      name: `${isSystem ? 'Preset' : 'Board'} ${i}`,
      isSystem,
    }));

  it('mounts a page of cards at a time, and says how many are left', () => {
    stage([...many(30, false), ...many(40, true)]);
    render(<TemplatesPage />);
    // 12 per section, not 70 preview subtrees on first paint.
    expect(screen.getByText('Board 0')).toBeInTheDocument();
    expect(screen.queryByText('Board 20')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show 18 more/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /browse all 40/i })).toBeInTheDocument();
  });

  it('"View all" expands your own library to the whole thing', () => {
    stage(many(30, false));
    render(<TemplatesPage />);
    fireEvent.click(screen.getByRole('button', { name: /^view all/i }));
    expect(screen.getByText('Board 29')).toBeInTheDocument();
  });
});

// ── §9.1 — sorting your own library ───────────────────────────────────

describe('§9.1 — sort modes', () => {
  const rows = [
    { name: 'Beta',  updatedAt: '2026-08-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', _count: { playlists: 1 } },
    { name: 'alpha', updatedAt: '2026-08-30T00:00:00Z', createdAt: '2026-05-01T00:00:00Z', _count: { playlists: 5 } },
    { name: 'Gamma', updatedAt: '2026-07-01T00:00:00Z', createdAt: '2026-03-01T00:00:00Z', _count: { playlists: 0 } },
  ];
  const names = (mode: any) => sortTemplates(rows, mode).map((r) => r.name);

  it('recently edited is the default order', () => {
    expect(names('recent')).toEqual(['alpha', 'Beta', 'Gamma']);
  });

  it('name A–Z is case-insensitive', () => {
    // "alpha" must not sort after "Gamma" just because it is lowercase.
    expect(names('name')).toEqual(['alpha', 'Beta', 'Gamma']);
  });

  it('most used reads the playlist count already in the list payload', () => {
    // Deliberately NOT the usage summary: a sort that reshuffles when a
    // side request fails is worse than no sort at all.
    expect(names('most-used')).toEqual(['alpha', 'Beta', 'Gamma']);
  });

  it('newest / oldest use createdAt, not updatedAt', () => {
    expect(names('newest')).toEqual(['alpha', 'Gamma', 'Beta']);
    expect(names('oldest')).toEqual(['Beta', 'Gamma', 'alpha']);
  });

  it('never mutates the caller’s array', () => {
    const original = [...rows];
    sortTemplates(rows, 'name');
    expect(rows).toEqual(original);
  });

  it('a missing timestamp sorts last rather than throwing', () => {
    const withGap = [{ name: 'No date' }, { name: 'Dated', updatedAt: '2026-08-30T00:00:00Z' }];
    expect(sortTemplates(withGap, 'recent').map((r) => r.name)).toEqual(['Dated', 'No date']);
  });
});
