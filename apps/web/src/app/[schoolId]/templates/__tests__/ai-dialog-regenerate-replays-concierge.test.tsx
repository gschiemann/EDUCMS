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
 *
 * (2026-09-23) The Designer generates through a background job, and a batch
 * that came from one is replayed by the SERVER — `…/jobs/:id/again` re-runs the
 * request that job persisted, so nothing the page forgot can be lost. The
 * page-side replay these tests were written for is now the fallback for when the
 * server cannot replay (the job was pruned after 7 days → 404, or its request no
 * longer validates → 422); the payload assertions below pin that fallback, and
 * the first tests pin that a live job is replayed server-side instead.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MENU_REFERENCE } from '@/components/templates/__tests__/concierge-menu-reference.fixture';
import { designerJobHookMocks, fakeDesignerJobs } from './designer-job-hooks.mock';
import { apiFetchError, jobNotFoundError, jobRequestInvalidError } from '../../../../../tests/fixtures/designer-job';

type Vars = Record<string, unknown>;
let templatesResult: Vars = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
// `jobs.starts` — every body POSTed to generate-designer/jobs (what `designerCalls` held when the
// page awaited the synchronous endpoint); `jobs.agains` — every server-side replay.
const jobs = fakeDesignerJobs();
const designerCalls = jobs.starts as Vars[];
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
  // Each job's boards: the three menu layouts the pipeline draws (rail-cards /
  // hero-cards / leader-rows), cut from the producer.
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
  jobs.reset();
  engineCalls.length = 0;
  stubReferences = [MENU_REFERENCE];
  stubIntake = { purpose: 'menu', theme: 'Bold', widgets: ['headline', 'menu', 'logo'] };
});

/** The job the cached (= on-screen) batch came from. */
const cachedJobId = () => JSON.parse(localStorage.getItem('vos:ai:lastbatch:riot') || 'null')?.jobId ?? null;

/**
 * Regenerate, and wait until the page has settled on the batch of job `expectJob`. (A generous
 * wait: the three boards re-render as srcdoc frames, which is slow on a loaded runner.)
 */
async function regenerate(expectJob: string) {
  fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
  await waitFor(() => expect(cachedJobId()).toBe(expectJob), { timeout: 10_000 });
  expect(screen.getByText('Pick your favorite')).toBeInTheDocument();
}

it('Regenerate replays a job’s batch SERVER-SIDE — …/again of the job that made it, nothing re-sent, never the other generator', async () => {
  await generateFromConcierge();
  expect(designerCalls).toHaveLength(1);
  const first = designerCalls[0];
  // Sanity: the first request really carried what a replay must keep.
  expect(first.content).toContain('Al Pastor');
  expect(first.logoUrl).toBe('https://supertaco.example/logo.svg');
  expect(first.venueName).toBe('Super Taco');

  await regenerate('job-2');
  expect(jobs.agains).toEqual(['job-1']); // the server re-runs the request job-1 persisted
  expect(designerCalls).toHaveLength(1); // …so the page sends nothing it might have forgotten
  expect(engineCalls).toHaveLength(0); // never the other generator
});

it('when the server can no longer replay it (a pruned job: 404), the page replays the Concierge request itself — menu, logo, photo, palette, reference, venue', async () => {
  await generateFromConcierge();
  const first = designerCalls[0];
  jobs.againError = apiFetchError(jobNotFoundError());

  await regenerate('job-2');
  expect(jobs.agains).toEqual(['job-1']);
  expect(designerCalls).toHaveLength(2);
  expect(engineCalls).toHaveLength(0);
  expect(pick(designerCalls[1])).toEqual(pick(first));
  // No error for the operator: the fallback is the answer.
  expect(screen.queryByRole('alert')).toBeNull();
});

it('a website with no menu keeps siteMenuMissing on the replay (the price book stays off the board)', async () => {
  stubReferences = [{ kind: 'url', label: 'supertacomex.com', summary: 'Brand: Super Taco. What they are / sell: "Mexican restaurant".', palette: ['#d83c21'] }];
  await generateFromConcierge();
  expect(designerCalls[0].siteMenuMissing).toBe(true);
  // A stored request this build no longer accepts (422) → the page's own replay.
  jobs.againError = apiFetchError(jobRequestInvalidError());
  await regenerate('job-2');
  expect(designerCalls).toHaveLength(2);
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

it('a RESUMED Concierge batch regenerates the same way (the job id and the replay ride the batch cache)', async () => {
  await generateFromConcierge();
  const first = designerCalls[0];
  const cached = JSON.parse(localStorage.getItem('vos:ai:lastbatch:riot') || 'null');
  expect(cached?.jobId).toBe('job-1');
  expect(cached?.replay?.designerExtras?.venueName).toBe('Super Taco');
  expect(cached?.replay?.brief).toBeUndefined(); // the brief is cached on its own

  // A fresh visit: open the dialog, resume the cached batch, Regenerate — server-side.
  cleanup();
  jobs.starts.length = 0;
  render(<TemplatesPage />);
  fireEvent.click(screen.getAllByRole('button', { name: /generate .*ai|with ai/i })[0]);
  await screen.findByText('Generate a template with AI');
  fireEvent.click(await screen.findByRole('button', { name: /resume your last 3 generated boards/i }));
  await screen.findByText('Pick your favorite');
  await regenerate('job-2');
  expect(jobs.agains).toEqual(['job-1']);
  expect(designerCalls).toHaveLength(0);

  // …and once the server has let that job go, the cached request is replayed as it was.
  jobs.againError = apiFetchError(jobNotFoundError());
  await regenerate('job-3');
  expect(jobs.agains).toEqual(['job-1', 'job-2']);
  expect(designerCalls).toHaveLength(1);
  expect(engineCalls).toHaveLength(0);
  expect(pick(designerCalls[0])).toEqual(pick(first));
});
