/**
 * "New template" — the create flow, MOUNTED (Phase 1).
 *
 * WHY THIS FILE EXISTS. The sibling predicate suite
 * (`components/templates/__tests__/create-template-flow.test.ts`) pins the
 * RULES. It cannot tell you whether the operator can reach them: this repo
 * shipped six green tests for a sidebar that had been un-mounted for three
 * and a half months, and three rounds of widget edits into a file that was
 * never rendered. So this suite renders the REAL default-exported page,
 * clicks the REAL "New template" button, and asserts on what an operator
 * would actually see and what the API would actually be asked for.
 *
 * What it holds down:
 *   · the modal asks ONE question — name + shape — and the 16-tile
 *     resolution grid is DEMOTED behind "Advanced", not deleted;
 *   · continuing lands on a GALLERY of real rendered presets, never the
 *     builder canvas;
 *   · the gallery is filtered to the chosen shape;
 *   · picking a preset creates FROM THAT PRESET with the operator's name;
 *   · "Start from blank" still sends the exact old create request;
 *   · "Describe it instead" opens the existing AI intake wizard;
 *   · no match is an explanation plus the two doors, never an empty grid.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// ── The data layer, staged ────────────────────────────────────────────
let templatesResult: any = { data: [], isLoading: false, isError: false, refetch: jest.fn() };

const createTemplateMock = jest.fn().mockResolvedValue({ id: 'new-1', name: 'New', isSystem: false });
const createFromPresetMock = jest.fn().mockResolvedValue({
  id: 'copy-1', name: 'Front desk', isSystem: false, screenWidth: 3840, screenHeight: 2160,
});
const updateTemplateMock = jest.fn().mockResolvedValue({ id: 'copy-1' });

const noopMutation = () => ({ mutateAsync: jest.fn(), isPending: false, mutate: jest.fn() });

jest.mock('@/hooks/use-api', () => ({
  useTemplates: () => templatesResult,
  useTemplateUsageSummary: () => ({ data: undefined }),
  useTenantBranding: () => ({ data: null }),
  useCreateTemplate: () => ({ mutateAsync: createTemplateMock, isPending: false }),
  useCreateFromPreset: () => ({ mutateAsync: createFromPresetMock, isPending: false }),
  useUpdateTemplate: () => ({ mutateAsync: updateTemplateMock, isPending: false }),
  useDeleteTemplate: noopMutation,
  useDuplicateTemplate: noopMutation,
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

jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'riot-fitness' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

// The tenant's industry is deliberately NOT proven here — `verticalKnown`
// false is the state a cached `edu_cms_user` blob routinely lands in, and
// the flow must not answer it with a school catalogue.
let verticalKnown = false;
jest.mock('@/hooks/use-tenant-copy', () => ({
  useTenantCopy: () => ({
    vertical: 'K12',
    get verticalKnown() { return verticalKnown; },
    orgSingular: 'Location',
    orgPlural: 'Locations',
    templateCategories: [
      { key: '', label: 'All' },
      { key: 'LOBBY', label: 'Welcome' },
      { key: 'CAFETERIA', label: 'Menus' },
    ],
    showSchoolLevelFilter: false,
    roleLabel: (r: string) => r,
  }),
}));

jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: any) => sel({ user: { role: 'SCHOOL_ADMIN' }, token: 't' }),
}));

jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: () => true, FLAGS: { TEMPLATE_BUILDER_V2: 'v2' } }));
jest.mock('@/components/ai/AiGenerateButton', () => ({ getAiStatusSource: async () => 'platform' }));
jest.mock('@/components/templates/SignageConcierge', () => ({ SignageConcierge: () => <div data-testid="concierge" /> }));
jest.mock('@/components/templates/BriefConfirmStrip', () => ({ BriefConfirmStrip: () => null }));
// The guided 6-question wizard that already existed and was unreachable from
// this path. Stubbed so its presence in the DOM IS the assertion.
jest.mock('@/components/templates/AiIntakeWizard', () => ({
  AiIntakeWizard: () => <div data-testid="ai-intake-wizard" />,
}));

// The real preview renderer, stubbed so the suite doesn't mount the entire
// widget catalogue. The point of the assertion is that the flow calls THIS
// module (the repo's one preview path) with the preset's own geometry.
const thumbProps: any[] = [];
jest.mock('@/components/templates/ScaledTemplateThumbnail', () => ({
  ScaledTemplateThumbnail: (props: any) => {
    thumbProps.push(props);
    return <div data-testid="scaled-thumb" data-w={props.screenWidth} data-h={props.screenHeight} />;
  },
}));

const alertMock = jest.fn().mockResolvedValue(undefined);
jest.mock('@/components/ui/app-dialog', () => ({
  appAlert: (...a: unknown[]) => alertMock(...a),
  appConfirm: jest.fn().mockResolvedValue(false),
}));

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

// jsdom has no matchMedia. Report a PHONE so `openInBuilder` takes its
// "open this on a larger screen" handoff instead of a hard navigation —
// the create request is what this suite is asserting on, not the nav.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: true, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }),
});

import TemplatesPage from '../page';

function preset(over: Record<string, unknown> = {}) {
  return {
    id: 'preset-lobby',
    name: 'Front Desk Welcome',
    description: '',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    isSystem: true,
    status: 'ACTIVE',
    zones: [{ id: 'z', name: 'Full', widgetType: 'TEXT', x: 0, y: 0, width: 100, height: 100 }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function stage(data: any[]) {
  templatesResult = { data, isLoading: false, isError: false, refetch: jest.fn() };
}

/** Open the flow and answer the one question. */
async function openFlow(name = 'Lobby board') {
  // The header button. An empty library also renders an onboarding copy of
  // it — both open the same flow, so the first one is the header's.
  fireEvent.click(screen.getAllByRole('button', { name: /new template/i })[0]);
  const dialog = await screen.findByRole('dialog', { name: /new template/i });
  if (name) fireEvent.change(within(dialog).getByLabelText(/what should we call it/i), { target: { value: name } });
  return dialog;
}

beforeEach(() => {
  jest.clearAllMocks();
  thumbProps.length = 0;
  verticalKnown = false;
  stage([]);
});

describe('the modal asks ONE question', () => {
  it('opens on name + shape, and does NOT open on the resolution grid', async () => {
    stage([preset()]);
    render(<TemplatesPage />);
    const dialog = await openFlow('');

    expect(within(dialog).getByLabelText(/what should we call it/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /landscape/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /portrait/i })).toBeInTheDocument();
    // The 16-tile grid and the metadata fields are behind the disclosure.
    expect(within(dialog).queryByText(/LED Poster/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/^Category$/i)).not.toBeInTheDocument();
  });

  it('DEMOTES the screen-size grid rather than deleting it', async () => {
    stage([preset()]);
    render(<TemplatesPage />);
    const dialog = await openFlow('');

    fireEvent.click(within(dialog).getByRole('button', { name: /advanced/i }));
    // Every LED-poster chain length and the custom W×H escape are still here.
    expect(within(dialog).getAllByText(/LED Poster/).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: /^Custom/ })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Category$/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Description$/i)).toBeInTheDocument();
  });

  it('will not continue without a name', async () => {
    stage([preset()]);
    render(<TemplatesPage />);
    const dialog = await openFlow('');
    expect(within(dialog).getByRole('button', { name: /continue/i })).toBeDisabled();
  });
});

describe('you land on a gallery, not a canvas', () => {
  it('shows REAL rendered presets for the chosen shape', async () => {
    stage([
      preset(),
      preset({ id: 'preset-totem', name: 'Hallway Totem', screenWidth: 2160, screenHeight: 3840 }),
      preset({ id: 'mine', name: 'My Own Board', isSystem: false }),
    ]);
    render(<TemplatesPage />);
    const dialog = await openFlow();
    fireEvent.click(within(dialog).getByRole('button', { name: /continue/i }));

    const gallery = await screen.findByRole('dialog', { name: /pick a starting point/i });
    expect(within(gallery).getByRole('button', { name: /Front Desk Welcome/ })).toBeInTheDocument();
    // Wrong shape, and the operator's own template, are both out.
    expect(within(gallery).queryByRole('button', { name: /Hallway Totem/ })).not.toBeInTheDocument();
    expect(within(gallery).queryByRole('button', { name: /My Own Board/ })).not.toBeInTheDocument();
    // The preview is the repo's real renderer, at the preset's own geometry.
    expect(within(gallery).getAllByTestId('scaled-thumb').length).toBe(1);
    expect(thumbProps[0]).toMatchObject({ screenWidth: 3840, screenHeight: 2160, freeze: true });
    // Nothing was created just by looking.
    expect(createTemplateMock).not.toHaveBeenCalled();
    expect(createFromPresetMock).not.toHaveBeenCalled();
  });

  it('re-filters when the operator picks the other shape', async () => {
    stage([preset(), preset({ id: 'preset-totem', name: 'Hallway Totem', screenWidth: 2160, screenHeight: 3840 })]);
    render(<TemplatesPage />);
    const dialog = await openFlow();
    fireEvent.click(within(dialog).getByRole('button', { name: /portrait/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /continue/i }));

    const gallery = await screen.findByRole('dialog', { name: /pick a starting point/i });
    expect(within(gallery).getByRole('button', { name: /Hallway Totem/ })).toBeInTheDocument();
    expect(within(gallery).queryByRole('button', { name: /Front Desk Welcome/ })).not.toBeInTheDocument();
  });

  it('parks keyboard focus on a real control when the step changes', async () => {
    // The button that had focus (Continue) unmounts. Without this, focus
    // lands on <body> and a keyboard operator restarts from the top of the
    // page — the same failure class as an unparked wall panel.
    stage([preset()]);
    render(<TemplatesPage />);
    const dialog = await openFlow();
    fireEvent.click(within(dialog).getByRole('button', { name: /continue/i }));
    const gallery = await screen.findByRole('dialog', { name: /pick a starting point/i });
    await waitFor(() =>
      expect(within(gallery).getByRole('button', { name: /back to name and shape/i })).toHaveFocus(),
    );
  });

  it('says so plainly when the industry is not proven — and never claims a match', async () => {
    stage([preset()]);
    render(<TemplatesPage />);
    const dialog = await openFlow();
    fireEvent.click(within(dialog).getByRole('button', { name: /continue/i }));
    const gallery = await screen.findByRole('dialog', { name: /pick a starting point/i });
    expect(within(gallery).getByText(/Showing a general selection/i)).toBeInTheDocument();
  });

  it('drops that line once the industry IS proven', async () => {
    verticalKnown = true;
    stage([preset()]);
    render(<TemplatesPage />);
    const dialog = await openFlow();
    fireEvent.click(within(dialog).getByRole('button', { name: /continue/i }));
    const gallery = await screen.findByRole('dialog', { name: /pick a starting point/i });
    expect(within(gallery).queryByText(/Showing a general selection/i)).not.toBeInTheDocument();
  });

  it('explains an empty gallery and still offers both doors — never a bare empty grid', async () => {
    stage([]); // nothing matches any shape
    render(<TemplatesPage />);
    const dialog = await openFlow();
    fireEvent.click(within(dialog).getByRole('button', { name: /continue/i }));

    const gallery = await screen.findByRole('dialog', { name: /pick a starting point/i });
    expect(within(gallery).getByText(/No ready-made board is built for a landscape screen yet/i)).toBeInTheDocument();
    expect(within(gallery).getByRole('button', { name: /start from blank/i })).toBeInTheDocument();
    expect(within(gallery).getByRole('button', { name: /describe it instead/i })).toBeInTheDocument();
  });
});

describe('the three doors actually do what they say', () => {
  it('picking a preset creates FROM THAT PRESET, carrying the operator\'s name', async () => {
    stage([preset()]);
    render(<TemplatesPage />);
    const dialog = await openFlow('Front desk');
    fireEvent.click(within(dialog).getByRole('button', { name: /continue/i }));
    const gallery = await screen.findByRole('dialog', { name: /pick a starting point/i });
    fireEvent.click(within(gallery).getByRole('button', { name: /Front Desk Welcome/ }));

    await waitFor(() => expect(createFromPresetMock).toHaveBeenCalledWith({
      presetId: 'preset-lobby',
      name: 'Front desk',
    }));
    // Same canvas as the preset → no pointless second write.
    expect(updateTemplateMock).not.toHaveBeenCalled();
  });

  it('carries the chosen canvas onto the copy when it differs from the preset', async () => {
    stage([preset()]);
    render(<TemplatesPage />);
    const dialog = await openFlow('Banner');
    fireEvent.click(within(dialog).getByRole('button', { name: /advanced/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /LED Banner/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /continue/i }));
    const gallery = await screen.findByRole('dialog', { name: /pick a starting point/i });
    fireEvent.click(within(gallery).getByRole('button', { name: /Front Desk Welcome/ }));

    await waitFor(() => expect(updateTemplateMock).toHaveBeenCalledWith({
      id: 'copy-1', orientation: 'LANDSCAPE', screenWidth: 2500, screenHeight: 500,
    }));
  });

  it('"Start from blank" sends exactly the request the old Create button sent', async () => {
    stage([preset()]);
    render(<TemplatesPage />);
    const dialog = await openFlow('Empty one');
    fireEvent.click(within(dialog).getByRole('button', { name: /continue/i }));
    const gallery = await screen.findByRole('dialog', { name: /pick a starting point/i });
    fireEvent.click(within(gallery).getByRole('button', { name: /start from blank/i }));

    await waitFor(() => expect(createTemplateMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Empty one',
      // Untouched form still posts CUSTOM, exactly as before — a blank
      // board must not silently land in the tenant's first category.
      category: 'CUSTOM',
      orientation: 'LANDSCAPE',
      screenWidth: 3840,
      screenHeight: 2160,
      // The seeded placeholder the builder's blank-template guidance keys on.
      zones: [{ name: 'Full Screen', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100 }],
    })));
  });

  it('"Describe it instead" opens the wizard that already existed', async () => {
    stage([preset()]);
    render(<TemplatesPage />);
    const dialog = await openFlow('Describe me');
    fireEvent.click(within(dialog).getByRole('button', { name: /continue/i }));
    const gallery = await screen.findByRole('dialog', { name: /pick a starting point/i });
    fireEvent.click(within(gallery).getByRole('button', { name: /describe it instead/i }));

    // The guided 6-question intake — not the chat, and not a new generator.
    expect(await screen.findByTestId('ai-intake-wizard')).toBeInTheDocument();
    expect(screen.queryByTestId('concierge')).not.toBeInTheDocument();
    expect(createTemplateMock).not.toHaveBeenCalled();
  });
});
