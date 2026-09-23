/**
 * Back from "Pick your favorite" must NOT lose the conversation (2026-09-22).
 *
 * Greg: "if i hit the back button from there it takes me to an empty prompt
 * again and loses everything i gave it". The Concierge keeps its transcript,
 * references, intake and brief in its own state; the dialog used to unmount
 * it whenever the picker was up, so Back started the interview over.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { designerJobHookMocks, fakeDesignerJobs } from './designer-job-hooks.mock';

// ── The data layer, staged ────────────────────────────────────────────
let templatesResult: any = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
let usageResult: any = { data: undefined };
// 2026-09-23 — the Designer generates through a background job; a started job answers `done`.
const jobs = fakeDesignerJobs();

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
  useGenerateTouchCandidates: () => ({
    mutateAsync: jest.fn(async () => ({ candidates: [1, 2, 3].map((n) => ({ name: `Draft ${n}`, spec: { name: `Draft ${n}` }, zones: [], background: '#111' })) })),
    isPending: false, mutate: jest.fn(),
  }),
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
  // The brief-echo step answers "no signal" so the page generates straight away
  // (the confirm interstitial is its own surface, not under test here).
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
// A stateful stand-in: what the operator typed lives in the component's OWN
// state, exactly like the real Concierge's transcript / intake / references.
// If the page unmounts it, that state is gone — which is the bug under test.
let conciergeMounts = 0;
jest.mock('@/components/templates/SignageConcierge', () => {
  const ReactActual = jest.requireActual('react');
  return {
    SignageConcierge: ({ onGenerate }: { onGenerate: (a: any) => void }) => {
      const [typed, setTyped] = ReactActual.useState('');
      ReactActual.useEffect(() => { conciergeMounts += 1; }, []);
      return (
        <div data-testid="concierge-stub">
          <input aria-label="chat draft" value={typed} onChange={(e: any) => setTyped(e.target.value)} />
          <button type="button" onClick={() => onGenerate({ prompt: 'menu board', intake: {}, references: [], userNotes: typed, wantsTouch: false })}>
            stub-generate
          </button>
        </div>
      );
    },
  };
});
jest.mock('@/components/templates/BriefConfirmStrip', () => ({ BriefConfirmStrip: () => null }));

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

import TemplatesPage from '../page';

beforeEach(() => {
  templatesResult = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
  usageResult = { data: undefined };
  mockRole = 'SCHOOL_ADMIN';
  conciergeMounts = 0;
  jobs.reset();
});

it('the Concierge stays mounted behind the picker, so Back returns to the SAME chat', async () => {
  render(<TemplatesPage />);
  fireEvent.click(screen.getAllByRole('button', { name: /generate .*ai|with ai/i })[0]);
  await screen.findByText('Generate a template with AI');
  const draft = screen.getByLabelText('chat draft') as HTMLInputElement;
  fireEvent.change(draft, { target: { value: 'super taco menu, pull items from the site' } });
  expect(conciergeMounts).toBe(1);

  fireEvent.click(screen.getByRole('button', { name: 'stub-generate' }));
  await screen.findByText('Pick your favorite');
  // The chat is out of sight while the boards are up, but still alive.
  // (jsdom loads no Tailwind CSS, so assert the wrapper's contract — the
  // `hidden` class + aria-hidden — rather than computed visibility.)
  const wrapper = () => screen.getByTestId('concierge-stub').closest('[aria-hidden]') as HTMLElement;
  expect(wrapper()).toHaveClass('hidden');
  expect(wrapper()).toHaveAttribute('aria-hidden', 'true');

  fireEvent.click(screen.getByRole('button', { name: /^← Back$/ }));
  await screen.findByText('Generate a template with AI');
  expect(wrapper()).toHaveClass('contents');
  expect(wrapper()).toHaveAttribute('aria-hidden', 'false');
  expect(conciergeMounts).toBe(1); // never remounted
  expect((screen.getByLabelText('chat draft') as HTMLInputElement).value).toBe('super taco menu, pull items from the site');
});
