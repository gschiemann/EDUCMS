/**
 * The site menu the Concierge read must reach the designer REQUEST (2026-09-22).
 *
 * Greg: "the menu items i asked to be pulled from the website i gave it, it
 * didnt fill the boards at all". The API now reads his real menu and hangs it
 * on the reference — but that only matters if the page actually puts it in the
 * generate call. This asserts the PAYLOAD, not an intermediate: `content` must
 * carry every item and every price, because that one field is what stops the
 * server reaching into the tenant's catalog (auto-grounding "only fills a
 * GAP"), grounds every price against the fact guard, and past 8 rows switches
 * the designer into full-board menu layout.
 *
 * The reference fixture is producer-cut from the real
 * POST /templates/concierge/reference/url — see concierge-menu-reference.fixture.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { designerJobHookMocks, fakeDesignerJobs } from './designer-job-hooks.mock';
import {
  MENU_REFERENCE,
  MENU_ROWS,
} from '@/components/templates/__tests__/concierge-menu-reference.fixture';

// ── The data layer, staged ────────────────────────────────────────────
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
  // The brief-echo interstitial answers "no signal", so the page generates
  // straight away (that confirm strip is its own surface, not under test).
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

// A stand-in for the chat that hands the page exactly what the real Concierge
// hands it once the operator has pasted their website: a ready brief plus the
// reference the API returned, menu and all.
let stubReferences: any[] = [];
let stubNotes = 'pull the menu items from the website i gave you';
jest.mock('@/components/templates/SignageConcierge', () => ({
  SignageConcierge: ({ onGenerate }: { onGenerate: (a: any) => void }) => (
    <button
      type="button"
      onClick={() =>
        onGenerate({
          prompt: 'A menu board for Super Taco showing every item and price from their site.',
          intake: { purpose: 'menu', theme: 'Bold', widgets: ['headline', 'menu', 'logo'] },
          references: stubReferences,
          userNotes: stubNotes,
          wantsTouch: false,
        })
      }
    >
      stub-generate
    </button>
  ),
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
  stubReferences = [];
  stubNotes = 'pull the menu items from the website i gave you';
});

it('sends EVERY item and price from the site menu as the designer `content`', async () => {
  stubReferences = [MENU_REFERENCE];
  const vars = await generate();

  expect(typeof vars.content).toBe('string');
  for (const [name, price] of MENU_ROWS) {
    expect(vars.content).toContain(name);
    expect(vars.content).toContain(price);
  }
  // Nine rows + one header — nothing sampled away on the way to the request.
  expect(vars.content.split('\n').filter(Boolean)).toHaveLength(MENU_ROWS.length + 1);
  // The API caps `content` at 8000.
  expect(vars.content.length).toBeLessThanOrEqual(8000);

  // The rest of the reference still rides as it always did — `content` is an
  // ADDITION, not a replacement for the brand summary.
  expect(vars.reference).toContain('Menu found on /menu: 9 items in 3 sections');
  expect(vars.palette).toEqual(['#e2452a', '#f4c430']);
  expect(vars.logoUrl).toBe('https://supertaco.example/logo.svg');
  expect(vars.heroImageUrl).toBe('https://supertaco.example/hero.jpg');
  expect(vars.purpose).toBe('menu');
  expect(vars.count).toBe(3);
});

it('a website with NO menu sends no `content` — and tells the server so (siteMenuMissing)', async () => {
  stubReferences = [{ kind: 'url', label: 'joecoffee.com', summary: 'Brand: Joe Coffee.', palette: ['#6f4e37'] }];
  const vars = await generate();
  expect(vars.content).toBeUndefined();
  // 2026-09-22 — without this the server filled the board from the account's
  // hand-entered price book (Greg's burger / fries / shake test rows).
  expect(vars.siteMenuMissing).toBe(true);
  expect(vars.reference).toContain('Joe Coffee');
  expect(vars.palette).toEqual(['#6f4e37']);
});

it('a website WITH a menu never raises siteMenuMissing', async () => {
  stubReferences = [MENU_REFERENCE];
  const vars = await generate();
  expect(vars.siteMenuMissing).toBeUndefined();
});

it('a menu PASTED into the chat becomes the board content, verbatim, with its section headers', async () => {
  stubReferences = [{ kind: 'url', label: 'supertacomex.com', summary: 'NO MENU COULD BE READ ON THIS SITE. Brand: Super Taco.' }];
  stubNotes = [
    'make a menu board with our menu',
    'BURRITOS',
    'Super Burrito $12.99',
    'Bean & Cheese Burrito $7.50',
    'TACOS',
    'Al Pastor Taco $3.25',
    'Carne Asada Taco $3.50',
  ].join('\n');
  const vars = await generate();
  expect(vars.content).toContain('REAL MENU typed or pasted by the operator in the chat. 4 priced items.');
  for (const row of ['BURRITOS:', 'Super Burrito $12.99', 'Bean & Cheese Burrito $7.50', 'TACOS:', 'Al Pastor Taco $3.25', 'Carne Asada Taco $3.50']) {
    expect(vars.content).toContain(row);
  }
  // The instruction line is not a menu row.
  expect(vars.content).not.toContain('make a menu board with our menu');
  // They supplied the menu themselves — nothing is "missing".
  expect(vars.siteMenuMissing).toBeUndefined();
});
