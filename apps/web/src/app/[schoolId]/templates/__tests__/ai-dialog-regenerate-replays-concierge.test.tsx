/**
 * "Regenerate" after a Concierge batch must replay THAT request (2026-09-22).
 *
 * Research report 02 (§1b) and 01 (bug 8): the pick grid's Regenerate called
 * the guided-form path with just the prompt. With the Designer toggle off (its
 * default) that went to the OTHER generator, and it dropped everything the chat
 * had gathered — the site menu (`content`), `siteMenuMissing`, the logo, the
 * photo, the palette and the website reference. A second try was a different,
 * worse board, and it could pull the hand-typed price book the first request
 * had kept off.
 *
 * This asserts the PAYLOAD: the second Designer call carries exactly what the
 * first did. It also pins the other two Concierge-path fixes that ride the same
 * request: `venueName` (never sent before) and the pick-grid labels, which now
 * name the layout each option was actually built as.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MENU_REFERENCE } from '@/components/templates/__tests__/concierge-menu-reference.fixture';

type Vars = Record<string, unknown>;
let templatesResult: Vars = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
const designerCalls: Vars[] = [];
const engineCalls: Vars[] = [];

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
  // The OTHER generator (the engine). Regenerate must never land here after a
  // Concierge batch.
  useGenerateTouchCandidates: () => ({
    mutateAsync: jest.fn(async (vars: Vars) => {
      engineCalls.push(vars);
      return { candidates: [] };
    }),
    isPending: false,
    mutate: jest.fn(),
  }),
  useCreateFromCandidate: noopMutation,
  useRefineSignageBoard: noopMutation,
  useGenerateDesignerCandidates: () => ({
    mutateAsync: jest.fn(async (vars: Vars) => {
      designerCalls.push(vars);
      return {
        batchId: `b${designerCalls.length}`,
        candidates: [
          { name: 'Board 1', html: '<html></html>', artDirection: 'Rail + cards', structure: 'rail-cards' },
          { name: 'Board 2', html: '<html></html>', artDirection: 'Hero + cards', structure: 'hero-cards' },
          { name: 'Board 3', html: '<html></html>', artDirection: 'Leader rows', structure: 'leader-rows' },
        ],
      };
    }),
    isPending: false,
    mutate: jest.fn(),
  }),
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
  buildDesignerBriefPayload: () => undefined,
  designerBriefHasSignal: () => false,
}));

jest.mock('@/lib/put-on-screen', () => ({
  usePutOnScreen: () => ({ putOnScreen: jest.fn(), puttingOnScreenId: null }),
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'riot' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));
jest.mock('@/hooks/use-tenant-copy', () => ({
  // A K-12 account (RIOT) designing a taqueria's board — the incident shape.
  useTenantCopy: () => ({
    vertical: 'K12',
    orgSingular: 'School',
    orgPlural: 'Schools',
    templateCategories: [{ key: '', label: 'All' }],
    showSchoolLevelFilter: false,
    roleLabel: (r: string) => r,
  }),
}));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: Vars) => unknown) => sel({ user: { role: 'SCHOOL_ADMIN' }, token: 't' }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: () => true, FLAGS: { TEMPLATE_BUILDER_V2: 'v2' } }));
jest.mock('@/components/ai/AiGenerateButton', () => ({ getAiStatusSource: async () => 'platform' }));
jest.mock('@/components/templates/AiIntakeWizard', () => ({ AiIntakeWizard: () => null }));
jest.mock('@/components/templates/BriefConfirmStrip', () => ({ BriefConfirmStrip: () => null }));

let stubReferences: unknown[] = [];
let stubIntake: Vars = { purpose: 'menu', theme: 'Bold', widgets: ['headline', 'menu', 'logo'] };
jest.mock('@/components/templates/SignageConcierge', () => ({
  SignageConcierge: ({ onGenerate }: { onGenerate: (a: Vars) => void }) => (
    <button
      type="button"
      onClick={() =>
        onGenerate({
          prompt: 'A menu board for Super Taco showing every item and price from their site.',
          intake: stubIntake,
          references: stubReferences,
          userNotes: 'pull the menu items from the website i gave you',
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

async function generateFromConcierge() {
  render(<TemplatesPage />);
  fireEvent.click(screen.getAllByRole('button', { name: /generate .*ai|with ai/i })[0]);
  await screen.findByText('Generate a template with AI');
  fireEvent.click(screen.getByRole('button', { name: 'stub-generate' }));
  await screen.findByText('Pick your favorite');
}

/** The fields a Concierge request carries that a replay must not lose. */
const REPLAYED = ['prompt', 'content', 'siteMenuMissing', 'menuSource', 'logoUrl', 'heroImageUrl', 'palette', 'reference', 'venueName', 'purpose', 'screenWidth', 'screenHeight', 'count'];
const pick = (vars: Vars) => Object.fromEntries(REPLAYED.map((k) => [k, vars[k]]));

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom always has it */ }
  templatesResult = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
  designerCalls.length = 0;
  engineCalls.length = 0;
  stubReferences = [MENU_REFERENCE];
  stubIntake = { purpose: 'menu', theme: 'Bold', widgets: ['headline', 'menu', 'logo'] };
});

it('Regenerate replays the Concierge request through the Designer — menu, logo, photo, palette, reference, venue', async () => {
  await generateFromConcierge();
  expect(designerCalls).toHaveLength(1);
  const first = designerCalls[0];
  // Sanity: the first request really carried what a replay must keep.
  expect(first.content).toContain('Al Pastor');
  expect(first.logoUrl).toBe('https://supertaco.example/logo.svg');
  expect(first.venueName).toBe('Super Taco');

  fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
  await waitFor(() => expect(designerCalls).toHaveLength(2));
  expect(engineCalls).toHaveLength(0); // never the other generator
  expect(pick(designerCalls[1])).toEqual(pick(first));
});

it('a website with no menu keeps siteMenuMissing on the replay (the price book stays off the board)', async () => {
  stubReferences = [{ kind: 'url', label: 'supertacomex.com', summary: 'Brand: Super Taco. What they are / sell: "Mexican restaurant".', palette: ['#d83c21'] }];
  await generateFromConcierge();
  expect(designerCalls[0].siteMenuMissing).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
  await waitFor(() => expect(designerCalls).toHaveLength(2));
  expect(designerCalls[1].siteMenuMissing).toBe(true);
  expect(designerCalls[1].venueName).toBe('Super Taco');
  expect(designerCalls[1].palette).toEqual(['#d83c21']);
});

it('the pick grid names the layout each option was actually built as', async () => {
  await generateFromConcierge();
  expect(screen.getAllByText('Rail + cards').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Hero + cards').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Leader rows').length).toBeGreaterThan(0);
  // The old fixed labels described nothing that was requested.
  expect(screen.queryByText('Balanced')).toBeNull();
  expect(screen.queryByText('Detailed')).toBeNull();
});

it('a RESUMED Concierge batch regenerates the same way (the replay rides the batch cache)', async () => {
  await generateFromConcierge();
  const first = designerCalls[0];
  const cached = JSON.parse(localStorage.getItem('vos:ai:lastbatch:riot') || 'null');
  expect(cached?.replay?.designerExtras?.venueName).toBe('Super Taco');
  expect(cached?.replay?.brief).toBeUndefined(); // the brief is cached on its own

  // A fresh visit: open the dialog, resume the cached batch, Regenerate.
  cleanup();
  designerCalls.length = 0;
  render(<TemplatesPage />);
  fireEvent.click(screen.getAllByRole('button', { name: /generate .*ai|with ai/i })[0]);
  await screen.findByText('Generate a template with AI');
  fireEvent.click(await screen.findByRole('button', { name: /resume your last 3 generated boards/i }));
  await screen.findByText('Pick your favorite');
  fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
  await waitFor(() => expect(designerCalls).toHaveLength(1));
  expect(engineCalls).toHaveLength(0);
  expect(pick(designerCalls[0])).toEqual(pick(first));
});
