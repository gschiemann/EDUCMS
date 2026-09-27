/**
 * K-12 sports launch, lane B3 (2026-09-27). Greg: "make it visible for k-12 as
 * well" — the 51-preset sports pack now surfaces to a school (the API tags it
 * "SPORTS|K12"). A school must find it under ONE clear "Sports" tab and must
 * NOT have it mixed into "All" or its Welcome / Hallway / Cafeteria tabs —
 * fifty-one scoreboards and celebrations would bury the school catalogue.
 * A SPORTS venue's gallery is unchanged.
 *
 * Mounts the REAL default-exported page (CLAUDE.md rule #9).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { inertDesignerJobHooks } from './designer-job-hooks.mock';

let templatesResult: { data: unknown[]; isLoading: boolean; isError: boolean; refetch: jest.Mock } = {
  data: [],
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
};
const noopMutation = () => ({ mutateAsync: jest.fn(), isPending: false, mutate: jest.fn() });

jest.mock('@/hooks/use-api', () => ({
  useTemplates: () => templatesResult,
  useTemplateUsageSummary: () => ({ data: undefined }),
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
  ...inertDesignerJobHooks,
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
  useParams: () => ({ schoolId: 'lincoln-high' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

let mockVertical = 'K12';
jest.mock('@/hooks/use-tenant-copy', () => {
  // The real per-vertical tab sets — the point is what a school actually gets.
  const { VERTICAL_TEMPLATE_CATEGORIES } = jest.requireActual('@cms/api-types');
  return {
    useTenantCopy: () => ({
      vertical: mockVertical,
      verticalKnown: true,
      orgSingular: 'Location',
      orgPlural: 'Locations',
      templateCategories: VERTICAL_TEMPLATE_CATEGORIES[mockVertical],
      showSchoolLevelFilter: mockVertical === 'K12',
      roleLabel: (r: string) => r,
    }),
  };
});
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: { role: 'SCHOOL_ADMIN' }, token: 't' }),
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

import TemplatesPage, { isSportsPackTemplate, isAthleticsPreset } from '../page';

function preset(over: Record<string, unknown>) {
  return {
    description: '',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    isSystem: true,
    status: 'ACTIVE',
    zones: [{ id: 'z', name: 'Full', widgetType: 'TEXT', x: 0, y: 0, width: 100, height: 100 }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-08-31T11:00:00.000Z',
    ...over,
  };
}

const SCHOOL = preset({ id: 'preset-lobby', name: 'Front Office Welcome', category: 'LOBBY', vertical: 'K12' });
const SCOREBOARD = preset({ id: 'preset-sb-hs', name: 'Scoreboard · High School', category: 'EVENTS', vertical: 'SPORTS|K12' });
const CELEBRATION = preset({ id: 'sports-cel-touchdown', name: 'Touchdown Celebration', category: 'CELEBRATION', vertical: 'SPORTS|K12' });

beforeEach(() => {
  templatesResult = { data: [SCHOOL, SCOREBOARD, CELEBRATION], isLoading: false, isError: false, refetch: jest.fn() };
});

describe('the sports pack predicate', () => {
  it('matches a system preset tagged SPORTS, single or in a pipe list', () => {
    expect(isSportsPackTemplate({ isSystem: true, vertical: 'SPORTS|K12' })).toBe(true);
    expect(isSportsPackTemplate({ isSystem: true, vertical: 'SPORTS' })).toBe(true);
    expect(isSportsPackTemplate({ isSystem: true, vertical: 'K12' })).toBe(false);
    // a school's own template is never "the pack", whatever it is tagged
    expect(isSportsPackTemplate({ isSystem: false, vertical: 'SPORTS' })).toBe(false);
    expect(isAthleticsPreset(CELEBRATION as Parameters<typeof isAthleticsPreset>[0])).toBe(true);
  });
});

describe('a K-12 school', () => {
  beforeEach(() => { mockVertical = 'K12'; });

  it('sees a "Sports" tab carrying the pack, and "All" without it', () => {
    render(<TemplatesPage />);
    const sportsTab = screen.getByRole('button', { name: /^Sports\s*2$/ });
    expect(screen.queryByRole('button', { name: /^Athletics/ })).toBeNull();
    // "All" — the school board is there, the pack is not.
    expect(screen.getByText('Front Office Welcome')).toBeInTheDocument();
    expect(screen.queryByText('Scoreboard · High School')).not.toBeInTheDocument();
    expect(screen.queryByText('Touchdown Celebration')).not.toBeInTheDocument();

    fireEvent.click(sportsTab);
    expect(screen.getByText('Scoreboard · High School')).toBeInTheDocument();
    expect(screen.getByText('Touchdown Celebration')).toBeInTheDocument();
    expect(screen.queryByText('Front Office Welcome')).not.toBeInTheDocument();
  });
});

describe('a SPORTS venue (unchanged)', () => {
  beforeEach(() => { mockVertical = 'SPORTS'; });

  it('still sees the pack under All and its own Celebrations tab', () => {
    templatesResult = { data: [SCOREBOARD, CELEBRATION], isLoading: false, isError: false, refetch: jest.fn() };
    render(<TemplatesPage />);
    expect(screen.getByText('Scoreboard · High School')).toBeInTheDocument();
    expect(screen.getByText('Touchdown Celebration')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Celebrations\s*1$/ }));
    expect(screen.getByText('Touchdown Celebration')).toBeInTheDocument();
    expect(screen.queryByText('Scoreboard · High School')).not.toBeInTheDocument();
  });
});
