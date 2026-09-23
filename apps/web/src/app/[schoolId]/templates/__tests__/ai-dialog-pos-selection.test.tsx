/**
 * The Concierge's POS pick must reach the designer REQUEST (2026-09-22).
 *
 * Greg: "…ensures the template is created with perfect integrations into those
 * systems". When the operator picks "Use your Toast menu" in the Concierge's
 * card, Generate must carry `posSelection` — the server then builds the board's
 * item list from that POS and binds every row. An explicit POS pick REPLACES any
 * site/pasted menu: the request carries no `content`, and no siteMenuMissing.
 *
 * The page is the real TemplatesPage; the Concierge is a stand-in that hands
 * the page exactly what the real one hands it (see ai-dialog-site-menu-content
 * for the same harness). The site reference is producer-cut.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { designerJobHookMocks, fakeDesignerJobs } from './designer-job-hooks.mock';
import { MENU_REFERENCE } from '@/components/templates/__tests__/concierge-menu-reference.fixture';

let templatesResult: any = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
// 2026-09-23 — the Designer generates through a background job (a started job answers `done`);
// `jobs.starts` holds each request body — what `designerCalls` held when the page awaited the
// synchronous endpoint.
const jobs = fakeDesignerJobs();
const designerCalls = jobs.starts as any[];
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
  ...designerJobHookMocks(jobs),
  useCreateDesigner: noopMutation,
  useRegenerateBoardImage: noopMutation,
  useAssets: () => ({ data: [], isLoading: false }),
  usePlaylists: () => ({ data: [], isLoading: false }),
  useAssetFolders: () => ({ data: [], isLoading: false }),
  useScreens: () => ({ data: [], isLoading: false }),
}));

jest.mock('@/hooks/use-ai-designer', () => ({
  useExtractDesignerBrief: () => ({
    mutate: (_vars: unknown, cb: { onSuccess: (r: { brief: null }) => void }) => cb.onSuccess({ brief: null }),
    mutateAsync: jest.fn(), isPending: false,
  }),
  useRefineDesignerBoard: () => ({ mutateAsync: jest.fn(), isPending: false }),
  buildDesignerBriefPayload: () => ({}),
  designerBriefHasSignal: () => false,
}));

jest.mock('@/lib/put-on-screen', () => ({
  usePutOnScreen: () => ({ putOnScreen: jest.fn(), puttingOnScreenId: null }),
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'super-taco' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));
jest.mock('@/hooks/use-tenant-copy', () => ({
  useTenantCopy: () => ({
    vertical: 'RESTAURANT',
    orgSingular: 'Location',
    orgPlural: 'Locations',
    templateCategories: [{ key: '', label: 'All' }],
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
jest.mock('@/components/templates/AiIntakeWizard', () => ({ AiIntakeWizard: () => null }));
jest.mock('@/components/templates/BriefConfirmStrip', () => ({ BriefConfirmStrip: () => null }));

// The Concierge stand-in: what the real one hands the page after the operator
// ticked Tacos + Burritos in the card and pressed Generate. It also records the
// props the page gave it (posEnabled must be on).
let stubPos: any = { connectionId: 'conn-chain-toast', sections: ['Tacos', 'Burritos'] };
let stubReferences: any[] = [];
const conciergeProps: any[] = [];
jest.mock('@/components/templates/SignageConcierge', () => ({
  SignageConcierge: (props: any) => {
    conciergeProps.push(props);
    return (
      <button
        type="button"
        onClick={() =>
          props.onGenerate({
            prompt: 'A menu board for Super Taco using the live Toast menu.',
            intake: { purpose: 'menu', theme: 'Bold', widgets: ['headline', 'menu', 'logo'] },
            references: stubReferences,
            userNotes: 'a menu board for the counter\nUse my Toast menu: Tacos, Burritos.',
            wantsTouch: false,
            ...(stubPos ? { posSelection: stubPos } : {}),
          })
        }
      >
        stub-generate
      </button>
    );
  },
}));

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

import TemplatesPage from '../page';

async function generate() {
  render(<TemplatesPage />);
  fireEvent.click(screen.getAllByRole('button', { name: /generate .*ai|with ai/i })[0]);
  await screen.findByText('Generate a template with AI');
  fireEvent.click(screen.getByRole('button', { name: 'stub-generate' }));
  await screen.findByText('Pick your favorite');
  return designerCalls[designerCalls.length - 1];
}

beforeEach(() => {
  templatesResult = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
  jobs.reset();
  conciergeProps.length = 0;
  stubPos = { connectionId: 'conn-chain-toast', sections: ['Tacos', 'Burritos'] };
  stubReferences = [];
});

it('the page turns the POS card on in the Concierge', async () => {
  render(<TemplatesPage />);
  fireEvent.click(screen.getAllByRole('button', { name: /generate .*ai|with ai/i })[0]);
  await screen.findByText('Generate a template with AI');
  expect(conciergeProps[conciergeProps.length - 1].posEnabled).toBe(true);
});

it('Generate carries the POS pick to the designer request', async () => {
  const vars = await generate();
  expect(vars.posSelection).toEqual({ connectionId: 'conn-chain-toast', sections: ['Tacos', 'Burritos'] });
  expect(vars.purpose).toBe('menu');
});

it('an explicit POS pick REPLACES a site menu: no content, no siteMenuMissing', async () => {
  stubReferences = [MENU_REFERENCE];
  const vars = await generate();
  expect(vars.posSelection).toBeDefined();
  expect(vars.content).toBeUndefined();
  expect(vars.siteMenuMissing).toBeUndefined();
  // The brand still rides — only the MENU source changed.
  expect(vars.reference).toContain('Menu found on /menu');
});

it('NEGATIVE CONTROL: with no pick, the site menu is the content exactly as before', async () => {
  stubPos = null;
  stubReferences = [MENU_REFERENCE];
  const vars = await generate();
  expect(vars.posSelection).toBeUndefined();
  expect(typeof vars.content).toBe('string');
});
